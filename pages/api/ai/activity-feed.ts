import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { isAccountActivated } from "@/lib/billing/requireActivatedAccount";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { AiQueuedReply } from "@/models/AiQueuedReply";
import AICallRecording from "@/models/AICallRecording";
import { LeadAIState } from "@/models/LeadAIState";
import CampaignActionLog from "@/models/CampaignActionLog";
import FBLeadCampaign from "@/models/FBLeadCampaign";

type Activity = {
  id: string;
  type: "call" | "text" | "booking" | "session" | "safety" | "ad";
  title: string;
  detail: string;
  at: string;
  leadId?: string;
  campaignId?: string;
  status?: string;
};

type LeadStateById = Map<string, any>;

function leadDisplayName(lead: any) {
  const parts = [
    lead?.name,
    lead?.["First Name"] && lead?.["Last Name"]
      ? `${lead["First Name"]} ${lead["Last Name"]}`
      : "",
    lead?.["First Name"],
    lead?.Name,
    lead?.Phone,
    lead?.Email,
  ].filter(Boolean);
  return String(parts[0] || "a lead").trim();
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isMeaningfulCallOutcome(outcome: string) {
  return ["booked", "callback", "not_interested", "do_not_call"].includes(outcome);
}

function textLedToLeadResponse(reply: any, statesByLeadId: LeadStateById) {
  const leadId = String(reply.leadId || "");
  const state = statesByLeadId.get(leadId);
  if (!state?.lastLeadInboundAt) return false;

  const responseAt = new Date(state.lastLeadInboundAt).getTime();
  const sentAt = new Date(reply.updatedAt || reply.createdAt).getTime();
  return Number.isFinite(responseAt) && Number.isFinite(sentAt) && responseAt >= sentAt;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const user = await User.findOne({ email }).lean();
  if (!isAccountActivated(user)) {
    return res.status(403).json({ error: "Account not activated" });
  }

  const userId = (user as any)?._id;
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 5), 50);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [queuedReplies, callRecordings, aiStates, actionLogs, campaigns] =
    await Promise.all([
      AiQueuedReply.find({ userEmail: email }).sort({ updatedAt: -1 }).limit(12).lean(),
      AICallRecording.find({ userEmail: email }).sort({ updatedAt: -1 }).limit(12).lean(),
      LeadAIState.find({ userEmail: email }).sort({ updatedAt: -1 }).limit(8).lean(),
      userId
        ? CampaignActionLog.find({ userId }).sort({ createdAt: -1 }).limit(12).lean()
        : [],
      userId
        ? FBLeadCampaign.find({ userId }).select("_id campaignName").lean()
        : [],
    ]);

  const leadIds = Array.from(
    new Set(
      [
        ...queuedReplies.map((r: any) => String(r.leadId || "")),
        ...callRecordings.map((r: any) => String(r.leadId || "")),
        ...aiStates.map((s: any) => String(s.leadId || "")),
      ].filter(Boolean),
    ),
  );

  const leads = leadIds.length
    ? await (Lead as any)
        .find({ _id: { $in: leadIds }, userEmail: email })
        .select({
          name: 1,
          Name: 1,
          "First Name": 1,
          "Last Name": 1,
          Phone: 1,
          Email: 1,
        })
        .lean()
    : [];

  const leadsById = new Map(leads.map((lead: any) => [String(lead._id), lead]));
  const statesByLeadId = new Map(aiStates.map((state: any) => [String(state.leadId), state]));
  const campaignsById = new Map(
    (campaigns as any[]).map((campaign) => [String(campaign._id), campaign]),
  );

  const activities: Activity[] = [
    ...queuedReplies.filter((reply: any) => {
      const status = String(reply.status || "");
      return status === "sent" && textLedToLeadResponse(reply, statesByLeadId);
    }).map((reply: any) => {
      const leadId = String(reply.leadId || "");
      const name = leadDisplayName(leadsById.get(leadId));
      return {
        id: `sms-${reply._id}`,
        type: "text" as const,
        title: `AI text got a response from ${name}`,
        detail: String(reply.body || "").slice(0, 140),
        at: new Date(reply.updatedAt || reply.createdAt).toISOString(),
        leadId,
        status: "responded",
      };
    }),
    ...callRecordings.filter((recording: any) => {
      const outcome = String(recording.outcome || "unknown");
      return isMeaningfulCallOutcome(outcome);
    }).map((recording: any) => {
      const leadId = String(recording.leadId || "");
      const name = leadDisplayName(leadsById.get(leadId));
      const outcome = String(recording.outcome || "unknown");
      return {
        id: `call-${recording._id}`,
        type: outcome === "booked" ? ("booking" as const) : ("call" as const),
        title: outcome === "booked" ? `AI booked ${name}` : `AI called ${name}`,
        detail:
          outcome === "unknown"
            ? "Call outcome pending"
            : `Outcome: ${titleCase(outcome)}`,
        at: new Date(recording.updatedAt || recording.createdAt).toISOString(),
        leadId,
        status: outcome,
      };
    }),
    ...(actionLogs as any[]).filter((log) => {
      const summary = (log.metaResponse as any)?.summary || {};
      return summary.dryRun || summary.requiresApproval || ["SCALE", "FIX", "PAUSE", "DUPLICATE_TEST"].includes(String(log.actionType || ""));
    }).map((log) => {
      const campaignId = String(log.campaignId || "");
      const campaign = campaignsById.get(campaignId);
      const summary = (log.metaResponse as any)?.summary || {};
      return {
        id: `ad-${log._id}`,
        type: "ad" as const,
        title: `AI ${titleCase(String(log.actionType || "recommended"))} recommendation`,
        detail:
          summary.message ||
          summary.reasoning ||
          `Campaign: ${campaign?.campaignName || "Facebook campaign"}`,
        at: new Date(log.createdAt).toISOString(),
        campaignId,
        status: String(log.actionType || ""),
      };
    }),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);

  const aiActionsToday = activities.filter((activity) => new Date(activity.at) >= startOfToday).length;
  const bookedToday = activities.filter(
    (activity) => activity.type === "booking" && new Date(activity.at) >= startOfToday,
  ).length;
  const pendingRecommendations = activities.filter(
    (activity) => activity.type === "ad" && new Date(activity.at) >= startOfToday,
  ).length;

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    activities,
    summary: {
      aiActionsToday,
      bookedToday,
      pendingRecommendations,
    },
  });
}

import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import CallLog from "@/models/CallLog";
import Booking from "@/models/Booking";
import Folder from "@/models/Folder";
import LeadInteractionEvent from "@/models/LeadInteractionEvent";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";
import FollowUpNudge from "@/models/FollowUpNudge";
import { LeadAIState } from "@/models/LeadAIState";
import { buildLeadContext } from "@/lib/ai/memory/buildLeadContext";
import { sendSms } from "@/lib/twilio/sendSMS";
import { decideReactivation } from "@/lib/ai/followup/decideReactivation";

export const config = {
  maxDuration: 60,
};

const MAX_LEADS_PER_RUN = 50;
const REACTIVATION_EVENT_TYPE = "ai_reactivation";
const INACTIVITY_CUTOFF = 30 * 24 * 60 * 60 * 1000;
const FALLBACK_MESSAGE =
  "Just wanted to check back in since timing can change. Are you still open to a quick call to go over options?";

function getLeadName(lead: any) {
  const first = String(lead?.["First Name"] || lead?.firstName || "").trim();
  const last = String(lead?.["Last Name"] || lead?.lastName || "").trim();
  return `${first} ${last}`.trim() || String(lead?.Phone || lead?.phone || "Lead");
}

function recentConversationText(messages: any[]) {
  return messages
    .slice()
    .reverse()
    .map((message) => `- ${String(message.direction || "unknown")}: ${String(message.text || "").trim()}`)
    .filter((line) => !line.endsWith(":"))
    .join("\n");
}

async function generateReactivationText(args: {
  userEmail: string;
  leadId: string;
  defaultMessage: string;
}) {
  const context = await buildLeadContext(args.userEmail, args.leadId).catch(() => null);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !context) return args.defaultMessage || FALLBACK_MESSAGE;

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content:
          "Write a short natural reactivation text to an old insurance lead. Do not sound robotic. Do not repeat old exact wording. Mention that you are following up because timing may have changed. Move toward booking a quick call.",
      },
      {
        role: "user",
        content: JSON.stringify({
          leadSummary: context.leadSummary || "",
          keyFacts: context.keyFacts || [],
          objections: context.objections || [],
          preferences: context.preferences || {},
          nextBestAction: context.nextBestAction || "",
          lastConversation: recentConversationText(context.lastMessages || []),
          suggestedMessage: args.defaultMessage || FALLBACK_MESSAGE,
        }),
      },
    ],
  });

  return String((response as any).output_text || args.defaultMessage || FALLBACK_MESSAGE).trim() || FALLBACK_MESSAGE;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  const cutoff = new Date(Date.now() - INACTIVITY_CUTOFF);

  const leads = await (Lead as any)
    .find({
      userEmail: { $exists: true, $ne: "" },
      updatedAt: { $lte: cutoff },
      status: { $nin: ["Sold", "Booked Appointment", "Bad Number"] },
    })
    .sort({ updatedAt: 1 })
    .limit(MAX_LEADS_PER_RUN)
    .lean();

  let evaluated = 0;
  let acted = 0;
  let smsSent = 0;
  let callTasks = 0;

  for (const lead of leads) {
    try {
      const leadId = String(lead._id);
      const userEmail = String(lead.userEmail || "").toLowerCase();
      if (!leadId || !userEmail) continue;

      const [memoryProfile, folderDoc, lastInbound, lastOutbound, lastCall, lastAppointment, reactivationCount, aiState] =
        await Promise.all([
          LeadMemoryProfile.findOne({ userEmail, leadId }).lean(),
          lead.folderId ? Folder.findById(lead.folderId).select({ name: 1 }).lean() : Promise.resolve(null),
          Message.findOne({ userEmail, leadId, direction: "inbound" }).sort({ createdAt: -1 }).lean(),
          Message.findOne({ userEmail, leadId, direction: { $in: ["outbound", "ai"] } }).sort({ createdAt: -1 }).lean(),
          CallLog.findOne({ userEmail, leadId }).sort({ timestamp: -1 }).lean(),
          (Booking as any)
            .findOne({
              agentEmail: userEmail,
              $or: [{ leadPhone: lead.Phone || lead.phone || "" }, { leadEmail: lead.Email || lead.email || "" }],
            })
            .sort({ date: -1 })
            .lean(),
          LeadInteractionEvent.countDocuments({ userEmail, leadId, type: REACTIVATION_EVENT_TYPE }),
          LeadAIState.findOne({ userEmail, leadId }).lean(),
        ]);

      const callRecord = Array.isArray(lastCall) ? lastCall[0] : lastCall;

      const decision = decideReactivation({
        lead,
        folderName: (folderDoc as any)?.name || "",
        memoryProfile: memoryProfile
          ? {
              shortSummary: memoryProfile.shortSummary,
              nextBestAction: memoryProfile.nextBestAction,
              objections: memoryProfile.objections,
              preferences: memoryProfile.preferences,
            }
          : null,
        stats: {
          lastInboundAt: lastInbound?.createdAt || null,
          lastOutboundAt: lastOutbound?.createdAt || null,
          lastCallAt: callRecord?.timestamp || null,
          lastAppointmentAt: lastAppointment?.date || lead.appointmentTime || null,
          reactivationCount,
          humanTextingActive:
            !!aiState?.aiSuppressedUntil && new Date(aiState.aiSuppressedUntil).getTime() > Date.now(),
        },
      });

      evaluated++;
      if (!decision.shouldReactivate) continue;

      if (decision.suggestedAction === "sms") {
        const to = String(lead.Phone || lead.phone || "").trim();
        if (!to) continue;

        const message = await generateReactivationText({
          userEmail,
          leadId,
          defaultMessage: decision.suggestedMessage || FALLBACK_MESSAGE,
        }).catch(() => decision.suggestedMessage || FALLBACK_MESSAGE);

        await sendSms({
          to,
          body: message,
          userEmail,
          leadId,
        });

        await LeadInteractionEvent.create({
          userEmail,
          leadId,
          type: REACTIVATION_EVENT_TYPE,
          direction: "outbound",
          body: message,
          metadata: {
            reason: decision.reason,
            suggestedAction: decision.suggestedAction,
            suggestedDelayHours: decision.suggestedDelayHours,
          },
          sourceId: `reactivation-cron:${new Date().toISOString()}`,
        });

        acted++;
        smsSent++;
        continue;
      }

      if (decision.suggestedAction === "call") {
        const leadName = getLeadName(lead);
        const existing = await FollowUpNudge.findOne({
          userEmail,
          leadId,
          dismissed: false,
          message: { $regex: /^Reactivation Call Task:/i },
        }).lean();

        if (!existing) {
          await FollowUpNudge.create({
            userEmail,
            leadId,
            leadName,
            message: `Reactivation Call Task: ${decision.reason}`,
            priority: "medium",
          });
        }

        await LeadInteractionEvent.create({
          userEmail,
          leadId,
          type: REACTIVATION_EVENT_TYPE,
          direction: "system",
          body: `Reactivation call task suggested: ${decision.reason}`,
          metadata: {
            reason: decision.reason,
            suggestedAction: decision.suggestedAction,
            suggestedDelayHours: decision.suggestedDelayHours,
          },
          sourceId: `reactivation-call-task:${new Date().toISOString()}`,
        });

        acted++;
        callTasks++;
      }
    } catch (err: any) {
      console.warn("[ai-reactivation] Lead processing failed:", err?.message || err);
    }
  }

  return res.status(200).json({
    ok: true,
    evaluated,
    acted,
    smsSent,
    callTasks,
  });
}

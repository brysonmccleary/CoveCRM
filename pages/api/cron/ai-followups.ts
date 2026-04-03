import type { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import CallLog from "@/models/CallLog";
import Booking from "@/models/Booking";
import LeadInteractionEvent from "@/models/LeadInteractionEvent";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";
import FollowUpNudge from "@/models/FollowUpNudge";
import { LeadAIState } from "@/models/LeadAIState";
import { buildLeadContext } from "@/lib/ai/memory/buildLeadContext";
import { sendSms } from "@/lib/twilio/sendSMS";
import { decideFollowUp } from "@/lib/ai/followup/decideFollowUp";

export const config = {
  maxDuration: 60,
};

const MAX_LEADS_PER_RUN = 50;
const FOLLOWUP_EVENT_TYPE = "ai_followup";

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

async function generateFollowUpText(args: {
  userEmail: string;
  leadId: string;
  defaultMessage: string;
}) {
  const context = await buildLeadContext(args.userEmail, args.leadId).catch(() => null);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !context) return args.defaultMessage;

  const client = new OpenAI({ apiKey });
  const response = await client.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content:
          "Write a short natural follow-up text to this lead. Do not repeat previous messages. Move toward booking an appointment.",
      },
      {
        role: "user",
        content: JSON.stringify({
          leadSummary: context.leadSummary || "",
          keyFacts: context.keyFacts || [],
          nextBestAction: context.nextBestAction || "",
          objections: context.objections || [],
          preferences: context.preferences || {},
          lastConversation: recentConversationText(context.lastMessages || []),
          suggestedMessage: args.defaultMessage,
        }),
      },
    ],
  });

  return String((response as any).output_text || args.defaultMessage).trim() || args.defaultMessage;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  const leads = await (Lead as any)
    .find({
      userEmail: { $exists: true, $ne: "" },
      status: { $nin: ["Not Interested", "Bad Number"] },
    })
    .sort({ updatedAt: -1 })
    .limit(MAX_LEADS_PER_RUN)
    .lean();

  let evaluated = 0;
  let acted = 0;

  for (const lead of leads) {
    try {
      const leadId = String(lead._id);
      const userEmail = String(lead.userEmail || "").toLowerCase();
      if (!leadId || !userEmail) continue;

      const [memoryProfile, lastInbound, lastOutbound, lastCall, lastAppointment, followupCount, aiState] =
        await Promise.all([
          LeadMemoryProfile.findOne({ userEmail, leadId }).lean(),
          Message.findOne({ userEmail, leadId, direction: "inbound" }).sort({ createdAt: -1 }).lean(),
          Message.findOne({ userEmail, leadId, direction: { $in: ["outbound", "ai"] } }).sort({ createdAt: -1 }).lean(),
          CallLog.findOne({ userEmail, leadId }).sort({ timestamp: -1 }).lean(),
          (Booking as any).findOne({
            agentEmail: userEmail,
            $or: [{ leadPhone: lead.Phone || lead.phone || "" }, { leadEmail: lead.Email || lead.email || "" }],
          })
            .sort({ date: -1 })
            .lean(),
          LeadInteractionEvent.countDocuments({ userEmail, leadId, type: FOLLOWUP_EVENT_TYPE }),
          LeadAIState.findOne({ userEmail, leadId }).lean(),
        ]);

      const callRecord = Array.isArray(lastCall) ? lastCall[0] : lastCall;

      const decision = decideFollowUp({
        lead,
        memoryProfile: memoryProfile
          ? {
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
          followupCount,
          humanTextingActive:
            !!aiState?.aiSuppressedUntil && new Date(aiState.aiSuppressedUntil).getTime() > Date.now(),
        },
      });

      evaluated++;
      if (!decision.shouldFollowUp) continue;

      if (decision.suggestedAction === "sms") {
        const to = String(lead.Phone || lead.phone || "").trim();
        if (!to) continue;

        const suggestedMessage = await generateFollowUpText({
          userEmail,
          leadId,
          defaultMessage: decision.suggestedMessage,
        }).catch(() => decision.suggestedMessage);

        await sendSms({
          to,
          body: suggestedMessage,
          userEmail,
          leadId,
        });

        await LeadInteractionEvent.create({
          userEmail,
          leadId,
          type: FOLLOWUP_EVENT_TYPE,
          direction: "outbound",
          body: suggestedMessage,
          metadata: {
            reason: decision.reason,
            suggestedAction: decision.suggestedAction,
            suggestedDelayHours: decision.suggestedDelayHours,
          },
          sourceId: `cron:${new Date().toISOString()}`,
        });

        acted++;
        continue;
      }

      if (decision.suggestedAction === "call") {
        const leadName = getLeadName(lead);
        const existing = await FollowUpNudge.findOne({
          userEmail,
          leadId,
          dismissed: false,
          message: { $regex: /^Call Task:/i },
        }).lean();

        if (!existing) {
          await FollowUpNudge.create({
            userEmail,
            leadId,
            leadName,
            message: `Call Task: ${decision.reason}`,
            priority: "medium",
          });
        }

        await LeadInteractionEvent.create({
          userEmail,
          leadId,
          type: FOLLOWUP_EVENT_TYPE,
          direction: "system",
          body: `Call task suggested: ${decision.reason}`,
          metadata: {
            reason: decision.reason,
            suggestedAction: decision.suggestedAction,
            suggestedDelayHours: decision.suggestedDelayHours,
          },
          sourceId: `call-task:${new Date().toISOString()}`,
        });

        acted++;
      }
    } catch (err: any) {
      console.warn("[ai-followups] Lead processing failed:", err?.message || err);
    }
  }

  return res.status(200).json({
    ok: true,
    evaluated,
    acted,
  });
}

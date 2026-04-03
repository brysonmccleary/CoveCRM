import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import CallLog from "@/models/CallLog";
import Call from "@/models/Call";
import LeadMemoryProfile from "@/models/LeadMemoryProfile";
import LeadMemoryFact from "@/models/LeadMemoryFact";
import calculatePriorityScore from "@/lib/ai/scoring/calculatePriorityScore";

export const config = {
  maxDuration: 60,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const RECENT_WINDOW_DAYS = 90;
const MAX_LEADS_PER_RUN = 200;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  const now = new Date();
  const refreshCutoff = new Date(now.getTime() - HOUR_MS);
  const recentCutoff = new Date(now.getTime() - RECENT_WINDOW_DAYS * DAY_MS);

  const leads = await (Lead as any)
    .find({
      userEmail: { $exists: true, $ne: "" },
      $or: [
        { updatedAt: { $gte: recentCutoff } },
        { createdAt: { $gte: recentCutoff } },
        { aiPriorityUpdatedAt: { $exists: false } },
        { aiPriorityUpdatedAt: null },
        { aiPriorityUpdatedAt: { $lt: refreshCutoff } },
      ],
    })
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(MAX_LEADS_PER_RUN)
    .lean();

  let evaluated = 0;
  let updated = 0;
  let errors = 0;
  let hot = 0;
  let warm = 0;
  let cold = 0;

  for (const lead of leads) {
    try {
      const leadId = String(lead._id);
      const userEmail = String(lead.userEmail || "").toLowerCase();
      if (!leadId || !userEmail) continue;

      const [latestInboundMessage, latestCallLog, latestCall, memoryProfile, memoryFacts, outboundMessageCount, callAttemptCount] =
        await Promise.all([
          Message.findOne({ userEmail, leadId: lead._id, direction: "inbound" }).sort({ createdAt: -1 }).lean(),
          CallLog.findOne({ userEmail, leadId }).sort({ timestamp: -1 }).lean(),
          (Call as any)
            .findOne({
              userEmail,
              leadId: { $in: [lead._id, leadId] },
            })
            .sort({ completedAt: -1, startedAt: -1, createdAt: -1 })
            .lean(),
          LeadMemoryProfile.findOne({ userEmail, leadId: lead._id }).lean(),
          LeadMemoryFact.find({ userEmail, leadId: lead._id, status: "active" })
            .sort({ updatedAt: -1 })
            .limit(20)
            .lean(),
          Message.countDocuments({ userEmail, leadId: lead._id, direction: { $in: ["outbound", "ai"] } }),
          CallLog.countDocuments({ userEmail, leadId }),
        ]);

      const result = calculatePriorityScore({
        lead,
        latestInboundMessage,
        latestCallLog,
        latestCall,
        memoryProfile,
        memoryFacts,
        attemptCount: outboundMessageCount + callAttemptCount,
        now,
      });

      evaluated++;
      if (result.category === "hot") hot++;
      else if (result.category === "warm") warm++;
      else cold++;

      const didChange =
        Number(lead.aiPriorityScore || 0) !== result.score ||
        String(lead.aiPriorityCategory || "cold") !== result.category;

      await (Lead as any).updateOne(
        { _id: lead._id },
        {
          $set: {
            aiPriorityScore: result.score,
            aiPriorityCategory: result.category,
            aiPriorityUpdatedAt: now,
          },
        }
      );

      if (didChange) updated++;
    } catch (err: any) {
      errors++;
      console.warn("[ai-priority-score] lead processing failed:", err?.message || err);
    }
  }

  return res.status(200).json({
    ok: true,
    evaluated,
    updated,
    errors,
    categories: {
      hot,
      warm,
      cold,
    },
  });
}

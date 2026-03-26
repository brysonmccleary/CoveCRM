// pages/api/cron/send-email-queue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import ProspectRecord from "@/models/ProspectRecord";
import EmailCampaign from "@/models/EmailCampaign";
import EmailMessage from "@/models/EmailMessage";
import { sendEmailWithTracking } from "@/lib/email/sendEmail";

export const config = { maxDuration: 60 };

const MAX_PER_RUN = 50;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  const now = new Date();

  // Find active enrollments that are due and not already processing
  const due = await ProspectRecord.find({
    status: "active",
    nextSendAt: { $lte: now },
    processing: { $ne: true },
    paused: { $ne: true },
    stopAll: { $ne: true },
  })
    .sort({ nextSendAt: 1 })
    .limit(MAX_PER_RUN)
    .lean();

  if (!due.length) {
    return res.status(200).json({ processed: 0, skipped: 0, total: 0 });
  }

  // Pre-load today's send counts per userEmail+campaignId combo
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const comboSet = new Set(
    due.map((r: any) => `${r.userEmail}:${String(r.campaignId)}`)
  );
  const dailyCounts = new Map<string, number>();

  for (const combo of comboSet) {
    const [uEmail, cId] = combo.split(":");
    const count = await EmailMessage.countDocuments({
      userEmail: uEmail,
      campaignId: cId,
      sentAt: { $gte: todayStart },
      status: { $in: ["sent", "delivered", "opened"] },
    });
    dailyCounts.set(combo, count);
  }

  let processed = 0;
  let skipped = 0;

  for (const record of due) {
    const r = record as any;
    const comboKey = `${r.userEmail}:${String(r.campaignId)}`;

    // Atomic claim — skip if another runner grabbed it
    const claimed = await ProspectRecord.updateOne(
      {
        _id: r._id,
        processing: { $ne: true },
        status: "active",
        nextSendAt: { $lte: now },
      },
      { $set: { processing: true, processingAt: new Date() } }
    );
    if (!(claimed as any).modifiedCount) continue;

    try {
      const campaign = (await EmailCampaign.findById(r.campaignId).lean()) as any;

      if (!campaign || !campaign.isActive) {
        await ProspectRecord.updateOne(
          { _id: r._id },
          { $set: { processing: false, status: "canceled" } }
        );
        continue;
      }

      const steps: any[] = campaign.steps || [];
      const step = steps[r.cursorStep];

      if (!step) {
        // No more steps — mark complete
        await ProspectRecord.updateOne(
          { _id: r._id },
          { $set: { processing: false, status: "completed" }, $unset: { nextSendAt: 1 } }
        );
        continue;
      }

      // Enforce daily pacing
      const dailyCount = dailyCounts.get(comboKey) || 0;
      if (dailyCount >= (campaign.dailyLimit || 100)) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        await ProspectRecord.updateOne(
          { _id: r._id },
          { $set: { processing: false, nextSendAt: tomorrow } }
        );
        skipped++;
        continue;
      }

      // Send
      const result = await sendEmailWithTracking({
        userId: r.userId,
        userEmail: r.userEmail,
        leadId: r.leadId,
        to: r.leadEmail,
        from: campaign.fromEmail || undefined,
        fromName: campaign.fromName || undefined,
        replyTo: campaign.replyTo || undefined,
        subject: step.subject,
        html: step.html,
        text: step.text || undefined,
        campaignId: r.campaignId,
        enrollmentId: r._id,
        stepIndex: r.cursorStep,
      });

      if (result.suppressed) {
        await ProspectRecord.updateOne(
          { _id: r._id },
          { $set: { processing: false, status: "canceled" } }
        );
        continue;
      }

      // Advance cursor
      const nextCursor = r.cursorStep + 1;
      const hasMore = nextCursor < steps.length;

      const setFields: Record<string, any> = {
        processing: false,
        cursorStep: nextCursor,
        lastSentAt: new Date(),
        [`sentAtByIndex.${r.cursorStep}`]: new Date(),
      };

      const update: Record<string, any> = { $set: setFields };

      if (hasMore) {
        const daysUntilNext =
          (steps[nextCursor].day ?? 0) - (step.day ?? 0);
        const nextSendAt = new Date();
        nextSendAt.setDate(nextSendAt.getDate() + Math.max(1, daysUntilNext));
        nextSendAt.setHours(9, 0, 0, 0);
        setFields.nextSendAt = nextSendAt;
      } else {
        setFields.status = "completed";
        update.$unset = { nextSendAt: 1 };
      }

      await ProspectRecord.updateOne({ _id: r._id }, update);

      // Update in-memory pacing counter
      dailyCounts.set(comboKey, (dailyCounts.get(comboKey) || 0) + 1);
      processed++;
    } catch (err: any) {
      console.error("[send-email-queue] Error processing record", r._id, err?.message);
      await ProspectRecord.updateOne(
        { _id: r._id },
        { $set: { processing: false, lastError: err?.message || "Unknown error" } }
      );
    }
  }

  return res.status(200).json({ processed, skipped, total: due.length });
}

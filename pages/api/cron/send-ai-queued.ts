// /pages/api/cron/send-ai-queued.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { acquireLock } from "@/lib/locks";
import { AiQueuedReply } from "@/models/AiQueuedReply";
import { LeadAIState } from "@/models/LeadAIState";
import { sendSms } from "@/lib/twilio/sendSMS";

export const config = {
  maxDuration: 60,
};

const MAX_PER_RUN = 25;
const MAX_ATTEMPTS = 5;

// If the lead hasn't replied since last human outbound, reschedule AI for a few days later
const DEFAULT_COOLDOWN_HOURS = 72;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Vercel cron hits with GET
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Centralized cron auth (?token=CRON_SECRET or Bearer)
  if (!checkCronAuth(req)) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  // Global kill switch if needed
  if (process.env.AI_SMS_HARD_STOP === "1") {
    console.warn("[send-ai-queued] HARD STOP enabled, exiting.");
    return res.status(204).end();
  }

  try {
    await dbConnect();

    // Prevent overlapping runs
    const locked = await acquireLock("cron", "send-ai-queued", 55);
    if (!locked) {
      console.log("[send-ai-queued] Another run in progress, skipping.");
      return res.status(200).json({ message: "Already running, skipped." });
    }

    const now = new Date();

    // Find due queued AI replies
    const due = await AiQueuedReply.find({
      status: "queued",
      sendAfter: { $lte: now },
      attempts: { $lt: MAX_ATTEMPTS },
    })
      .sort({ sendAfter: 1, createdAt: 1 })
      .limit(MAX_PER_RUN)
      .lean();

    if (!due.length) {
      console.log("[send-ai-queued] No queued messages due.");
      return res.status(200).json({
        ok: true,
        processed: 0,
        sent: 0,
        failed: 0,
        remaining: 0,
      });
    }

    console.log(
      `[send-ai-queued] Processing ${due.length} queued AI message(s) at ${now.toISOString()}`
    );

    let sent = 0;
    let failed = 0;
    let rescheduled = 0;

    const COOLDOWN_HOURS =
      Math.max(1, parseInt(process.env.AI_NO_REPLY_COOLDOWN_HOURS || String(DEFAULT_COOLDOWN_HOURS), 10)) ||
      DEFAULT_COOLDOWN_HOURS;

    for (const job of due) {
      const id = String(job._id);
      try {
        // ✅ NEW: suppression gate — if lead hasn't replied since last human outbound,
        // do NOT send now. Push sendAfter out by COOLDOWN_HOURS from lastHumanOutboundAt.
        try {
          const state = await LeadAIState.findOne({
            userEmail: job.userEmail,
            leadId: job.leadId,
          }).lean();

          const lastHuman = state?.lastHumanOutboundAt ? new Date(state.lastHumanOutboundAt) : null;
          const lastInbound = state?.lastLeadInboundAt ? new Date(state.lastLeadInboundAt) : null;
          const suppressedUntil = state?.aiSuppressedUntil ? new Date(state.aiSuppressedUntil) : null;

          const leadHasNotRepliedSinceHuman =
            !!lastHuman && (!lastInbound || lastInbound.getTime() <= lastHuman.getTime());

          const stillSuppressed = !!suppressedUntil && suppressedUntil.getTime() > now.getTime();

          if (leadHasNotRepliedSinceHuman && stillSuppressed) {
            const newSendAfter = new Date(lastHuman!.getTime() + COOLDOWN_HOURS * 60 * 60 * 1000);

            await AiQueuedReply.updateOne(
              { _id: job._id, status: "queued" },
              {
                $set: {
                  sendAfter: newSendAfter,
                  failReason: `cooldown_no_reply_until_${newSendAfter.toISOString()}`,
                },
              }
            );

            rescheduled++;
            console.log(
              `[send-ai-queued] ⏭️ Rescheduled queuedId=${id} (no reply since human outbound) -> ${newSendAfter.toISOString()}`
            );
            continue;
          }
        } catch (gateErr: any) {
          console.warn(`[send-ai-queued] ⚠️ gate check failed for ${id}:`, gateErr?.message || gateErr);
          // gate failure should NOT block sending; proceed
        }

        // Mark as "sending" and bump attempts, but only if still queued
        const updated = await AiQueuedReply.findOneAndUpdate(
          {
            _id: job._id,
            status: "queued",
            attempts: { $lt: MAX_ATTEMPTS },
          },
          {
            $set: { status: "sending" },
            $inc: { attempts: 1 },
          },
          { new: true }
        );

        if (!updated) {
          // Another worker grabbed or it changed; skip
          console.log(
            `[send-ai-queued] Skipping ${id} — no longer queued or max attempts reached.`
          );
          continue;
        }

        console.log(
          `[send-ai-queued] Sending queuedId=${id} to=${updated.to} (attempt ${updated.attempts})`
        );

        // Actually send via Twilio (no extra delay here)
        await sendSms({
          to: updated.to,
          body: updated.body,
          userEmail: updated.userEmail,
          // no delayMinutes: we already respected human delay when enqueuing
        });

        await AiQueuedReply.updateOne(
          { _id: updated._id },
          {
            $set: {
              status: "sent",
              failReason: undefined,
            },
          }
        );

        sent++;
        console.log(
          `[send-ai-queued] ✅ Sent queuedId=${id} to=${updated.to}`
        );
      } catch (err: any) {
        console.error(
          `[send-ai-queued] ❌ Error sending queuedId=${id}:`,
          err?.message || err
        );

        failed++;

        const reason =
          (err && (err.message || (err as any).toString())) ||
          "Unknown error";

        // If we hit max attempts, mark as permanently failed; else put back to queued
        const doc = await AiQueuedReply.findById(job._id);
        if (!doc) continue;

        if ((doc.attempts || 0) >= MAX_ATTEMPTS) {
          doc.status = "failed";
          doc.failReason = reason.slice(0, 500);
        } else {
          doc.status = "queued";
          doc.failReason = reason.slice(0, 500);
        }
        await doc.save();
      }
    }

    const remaining = await AiQueuedReply.countDocuments({
      status: "queued",
      sendAfter: { $lte: new Date() },
      attempts: { $lt: MAX_ATTEMPTS },
    });

    return res.status(200).json({
      ok: true,
      processed: due.length,
      sent,
      failed,
      rescheduled,
      remaining,
    });
  } catch (err: any) {
    console.error("[send-ai-queued] ❌ Cron error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

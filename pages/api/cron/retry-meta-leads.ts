// pages/api/cron/retry-meta-leads.ts
// Retries MetaLeadWebhookEvent records that failed processing.
// Finds: failed_retryable/retry_scheduled records whose nextRetryAt has passed,
//        "received" records older than 3 minutes that were never picked up,
//        and "processing" records older than 10 minutes (crash recovery).
// Called by vercel.json cron every 5 minutes.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import MetaLeadWebhookEvent from "@/models/MetaLeadWebhookEvent";
import { processMetaLead } from "@/lib/meta/processMetaLead";

const CRON_SECRET = process.env.CRON_SECRET || "";
const MAX_RETRIES_PER_RUN = 20;
const STALE_RECEIVED_MS = 3 * 60 * 1000;   // 3 minutes
const STALE_PROCESSING_MS = 10 * 60 * 1000; // 10 minutes — crash recovery window

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const token = String(req.query.token || req.headers["x-cron-token"] || "");
  if (CRON_SECRET && token !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await mongooseConnect();
    const now = new Date();
    const staleReceivedThreshold = new Date(now.getTime() - STALE_RECEIVED_MS);
    // If processMetaLead crashes mid-flight (e.g., during Lead.create or FBLeadEntry.create),
    // the event stays stuck as "processing" forever. Pick it up after 10 minutes for safe re-attempt.
    // processMetaLead checks for an existing Lead by metaLeadgenId at the top, so re-runs are idempotent.
    const staleProcessingThreshold = new Date(now.getTime() - STALE_PROCESSING_MS);

    const candidates = await MetaLeadWebhookEvent.find({
      $or: [
        {
          processingStatus: { $in: ["failed_retryable", "retry_scheduled"] },
          nextRetryAt: { $lte: now },
        },
        {
          processingStatus: "received",
          receivedAt: { $lte: staleReceivedThreshold },
        },
        {
          processingStatus: "processing",
          lastAttemptAt: { $lte: staleProcessingThreshold },
        },
      ],
    })
      .sort({ nextRetryAt: 1, receivedAt: 1 })
      .limit(MAX_RETRIES_PER_RUN)
      .select("leadgenId pageId formId adId adsetId metaCampaignId createdTime attemptCount")
      .lean() as any[];

    if (candidates.length === 0) {
      return res.status(200).json({ ok: true, retried: 0 });
    }

    // Mark all candidates as retry_scheduled before processing to prevent
    // concurrent cron runs from picking them up simultaneously
    const leadgenIds = candidates.map((c: any) => c.leadgenId);
    await MetaLeadWebhookEvent.updateMany(
      { leadgenId: { $in: leadgenIds }, processingStatus: { $nin: ["processed", "duplicate", "failed_permanent"] } },
      { $set: { processingStatus: "retry_scheduled" } }
    );

    let retried = 0;
    let succeeded = 0;
    const errors: string[] = [];

    for (const event of candidates) {
      try {
        await processMetaLead(
          event.leadgenId,
          event.pageId || "",
          event.formId || "",
          event.adId || "",
          event.adsetId || "",
          event.metaCampaignId || "",
          event.createdTime || ""
        );
        retried++;
        succeeded++;
      } catch (err: any) {
        retried++;
        const msg = `${event.leadgenId}: ${err?.message || "unknown"}`;
        errors.push(msg.slice(0, 200));
        console.error("[retry-meta-leads] retry failed:", msg);
      }
    }

    console.info(`[retry-meta-leads] retried=${retried} succeeded=${succeeded} errors=${errors.length}`);
    return res.status(200).json({ ok: true, retried, succeeded, errors });
  } catch (err: any) {
    console.error("[retry-meta-leads] cron error:", err?.message);
    return res.status(500).json({ error: err?.message || "cron failed" });
  }
}

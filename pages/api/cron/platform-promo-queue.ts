// pages/api/cron/platform-promo-queue.ts
// Daily cron — sends platform promo emails to DOI leads that have never been emailed.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import DOILead from "@/models/DOILead";
import PlatformEmailRecord from "@/models/PlatformEmailRecord";
import PlatformSender from "@/models/PlatformSender";
import { sendPlatformPromo } from "@/lib/prospecting/sendPlatformPromo";

export const config = { maxDuration: 60 };

const MAX_PER_RUN = 500;

// Default promo email content — set via env vars so marketing can change without deploys
const PROMO_SUBJECT =
  process.env.PLATFORM_PROMO_SUBJECT ||
  "Grow your insurance book with CoveCRM";

const PROMO_HTML =
  process.env.PLATFORM_PROMO_HTML ||
  `<p>Hi there,</p>
<p>We'd love to help you close more insurance clients with CoveCRM — the CRM built for independent agents.</p>
<p><a href="${process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com"}">Start your free trial</a></p>
<p>— The CoveCRM Team</p>
<hr />
<p style="font-size:11px;color:#888;">
  To unsubscribe, <a href="${process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com"}/api/email/doi-unsubscribe?email={{EMAIL}}">click here</a>.
</p>`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  // Reset daily counters for any sender whose lastResetAt is before today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  await PlatformSender.updateMany(
    { active: true, lastResetAt: { $lt: today } },
    { $set: { sentToday: 0, lastResetAt: new Date() } }
  );

  // Check total capacity remaining across all active senders
  const senders = await PlatformSender.find({ active: true }).lean() as any[];
  const totalCapacity = senders.reduce(
    (sum: number, s: any) => sum + Math.max(0, (s.dailyLimit || 200) - (s.sentToday || 0)),
    0
  );

  if (totalCapacity === 0) {
    return res.status(200).json({ processed: 0, skipped: 0, reason: "All senders at daily limit" });
  }

  const batchSize = Math.min(MAX_PER_RUN, totalCapacity);

  // Find emails that have already received a platform send (ever)
  const sentEmails = await PlatformEmailRecord.distinct("toEmail", {
    platformSend: true,
    status: { $in: ["sent"] },
  });

  // DOI leads that:
  // 1. Are not globally unsubscribed
  // 2. Have never received a platform promo (no sent PlatformEmailRecord)
  const candidates = await DOILead.find({
    globallyUnsubscribed: false,
    email: { $nin: sentEmails },
  })
    .select("_id email")
    .limit(batchSize)
    .lean() as any[];

  if (!candidates.length) {
    return res.status(200).json({ processed: 0, skipped: 0, reason: "No new leads to contact" });
  }

  let processed = 0;
  let skipped = 0;

  for (const lead of candidates) {
    const subject = PROMO_SUBJECT;
    const html = PROMO_HTML.replace(/\{\{EMAIL\}\}/g, encodeURIComponent(lead.email));

    const result = await sendPlatformPromo(String(lead._id), { subject, html });

    if (result.ok) {
      processed++;
    } else if (result.suppressed) {
      skipped++;
    } else if (result.skipped) {
      // Sender hit daily limit mid-run — stop
      break;
    } else {
      skipped++;
    }
  }

  return res.status(200).json({ processed, skipped, total: candidates.length });
}

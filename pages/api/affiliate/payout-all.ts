// /pages/api/affiliate/payout-all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import {
  affiliatePayoutsEnabled,
  processAffiliatePayoutsNow,
} from "../cron/process-affiliate-payouts";

function adminEmailSet() {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = String(session?.user?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!adminEmailSet().has(email)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (!affiliatePayoutsEnabled()) {
    return res.status(423).json({
      error: "Affiliate payouts disabled",
      enabledBy: "AFFILIATE_PAYOUTS_ENABLED",
    });
  }

  const result = await processAffiliatePayoutsNow();
  return res.status(202).json({
    ok: true,
    processed: result.processed,
    transferred: result.succeeded,
    skipped:
      result.skippedInactive +
      result.skippedBelowMinimum +
      result.skippedNotReady +
      result.claimMisses,
    failed: result.failed,
    skippedInactive: result.skippedInactive,
    skippedBelowMinimum: result.skippedBelowMinimum,
    skippedNotReady: result.skippedNotReady,
    claimMisses: result.claimMisses,
  });
}

// pages/api/cron/affiliate-payouts.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  return res.status(410).json({
    error:
      "Legacy affiliate payoutDue cron is disabled. Ledger payouts will be handled by the canonical payout worker.",
  });
}

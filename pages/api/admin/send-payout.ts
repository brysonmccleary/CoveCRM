// pages/api/admin/send-payout.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" });
  }

  return res.status(410).json({
    ok: false,
    message:
      "Legacy affiliate payoutDue payouts are disabled. Ledger payouts will be handled by the canonical payout worker.",
  });
}

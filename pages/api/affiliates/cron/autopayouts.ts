import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  return res.status(410).json({
    error:
      "Legacy affiliate payoutDue autopayouts are disabled. Ledger payouts will be handled by the canonical payout worker.",
  });
}

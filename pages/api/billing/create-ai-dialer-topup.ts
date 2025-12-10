// pages/api/billing/create-ai-dialer-topup.ts
// ❌ NO LONGER USED — AUTO-BILLING REPLACES THIS ENDPOINT
// (Keep the file so the route doesn’t 404, but disable it fully)

import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return res.status(410).json({
    ok: false,
    error: "This action is no longer available — AI Dialer now auto-bills when minutes reach zero.",
  });
}

// /pages/api/affiliate/add-referral.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  return res.status(410).json({
    message:
      "Affiliate referral credits are created only by verified Stripe payment webhooks.",
  });
}

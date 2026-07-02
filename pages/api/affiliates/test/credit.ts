import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  return res.status(410).json({
    error:
      "Test affiliate credits are disabled. Affiliate credits are created only by verified Stripe payment webhooks.",
  });
}

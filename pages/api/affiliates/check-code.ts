// /pages/api/affiliates/check-code.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

// Keep helpers in sync with other affiliate endpoints
const U = (s?: string | null) => (s || "").trim().toUpperCase();
const HOUSE_CODE = U(process.env.AFFILIATE_HOUSE_CODE || "COVE50");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    await dbConnect();

    const { code } = req.body;

    if (!code || typeof code !== "string") {
      return res.status(400).json({ error: "Missing or invalid code" });
    }

    const normalizedCode = U(code);
    if (!normalizedCode) {
      return res.status(400).json({ error: "Missing or invalid code" });
    }

    // Reserved house code is never available
    if (normalizedCode === HOUSE_CODE) {
      return res.status(200).json({
        available: false,
        reason: "reserved",
      });
    }

    // Check if any affiliate already has this code
    const exists = await Affiliate.findOne({ promoCode: normalizedCode });

    return res.status(200).json({ available: !exists });
  } catch (err) {
    console.error("Check-code error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// /pages/api/affiliate/check-code.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

// Simple helpers to mirror webhook behavior
const U = (s?: string | null) => (s || "").trim().toUpperCase();
// Same default as in the Stripe webhook handler
const HOUSE_CODE = U(process.env.AFFILIATE_HOUSE_CODE || "COVE50");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { code } = req.body;
  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing or invalid code" });
  }

  const promoCode = U(code);
  if (!promoCode) {
    return res.status(400).json({ error: "Missing or invalid code" });
  }

  // House / reserved code should never be claimable by affiliates
  if (promoCode === HOUSE_CODE) {
    return res.status(200).json({
      available: false,
      reason: "reserved",
    });
  }

  await dbConnect();

  const existing = await Affiliate.findOne({ promoCode });

  return res.status(200).json({ available: !existing });
}

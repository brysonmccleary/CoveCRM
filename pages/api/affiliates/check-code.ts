import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

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

    const normalizedCode = code.trim().toUpperCase();

    // Check if any affiliate already has this code
    const exists = await Affiliate.findOne({ promoCode: normalizedCode });

    return res.status(200).json({ available: !exists });
  } catch (err) {
    console.error("Check-code error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

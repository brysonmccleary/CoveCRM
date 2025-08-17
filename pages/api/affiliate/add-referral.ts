// /pages/api/affiliate/add-referral.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const { promoCode, referredEmail, amountPaid = 0 } = req.body;
  if (!promoCode || !referredEmail) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    await dbConnect();
    const affiliate = await Affiliate.findOne({ promoCode: promoCode.toUpperCase() });
    if (!affiliate) return res.status(404).json({ message: "Affiliate not found" });

    // Update tracking data
    affiliate.totalRedemptions += 1;
    affiliate.totalRevenueGenerated += amountPaid;
    affiliate.payoutDue += affiliate.flatPayoutAmount;

    await affiliate.save();

    res.status(200).json({ message: "Referral tracked successfully" });
  } catch (error) {
    console.error("Add referral error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
}

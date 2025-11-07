// /pages/api/affiliates/all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const PLAN_PRICE = 199.99;
const COMMISSION_PER_USER = 25;

type GroupBucket = {
  users: any[];
  activeCount: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await mongooseConnect();

    // pull only what we need
    const allUsers = await User.find(
      { referredBy: { $exists: true, $ne: null } },
      { referredBy: 1, subscriptionStatus: 1, name: 1, email: 1, plan: 1 }
    ).lean();

    const grouped: Record<string, GroupBucket> = {};

    allUsers.forEach((user: any) => {
      // Normalize key so it’s always a string
      const code = String(user.referredBy || "");
      if (!code) return;

      if (!grouped[code]) grouped[code] = { users: [], activeCount: 0 };
      grouped[code].users.push(user);
      if (user.subscriptionStatus === "active") {
        grouped[code].activeCount++;
      }
    });

    const affiliateStats = await Promise.all(
      Object.entries(grouped).map(async ([code, data]) => {
        // Try to resolve the owner by referralCode first; if not found and code looks like an ObjectId, try _id
        let owner =
          (await User.findOne({ referralCode: code }, { name: 1, email: 1 }).lean()) ||
          (mongoose.isValidObjectId(code)
            ? await User.findById(code, { name: 1, email: 1 }).lean()
            : null);

        return {
          name: owner?.name || "Unknown",
          email: owner?.email || "N/A",
          promoCode: code,
          totalRedemptions: data.users.length,
          totalRevenueGenerated: Number((data.activeCount * PLAN_PRICE).toFixed(2)),
          payoutDue: data.activeCount * COMMISSION_PER_USER,
        };
      })
    );

    // Sort by total redemptions, desc
    affiliateStats.sort((a, b) => b.totalRedemptions - a.totalRedemptions);

    return res.status(200).json(affiliateStats);
  } catch (err) {
    console.error("Affiliate summary error:", err);
    return res.status(500).json({ error: "Failed to load affiliate data." });
  }
}

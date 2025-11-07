// /pages/api/affiliates/all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const PLAN_PRICE = 199.99;
const COMMISSION_PER_USER = 25;

// Comma-separated list of non-commissionable promo codes (house codes)
const HOUSE_CODES = new Set(
  (process.env.HOUSE_CODES || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

type GroupBucket = {
  users: any[];
  activeCount: number;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await mongooseConnect();

    const allUsers = await User.find(
      { referredBy: { $exists: true, $ne: null } },
      { referredBy: 1, subscriptionStatus: 1, name: 1, email: 1, plan: 1 }
    ).lean();

    const grouped: Record<string, GroupBucket> = {};

    allUsers.forEach((user: any) => {
      const code = String(user.referredBy || "");
      if (!code) return;
      const key = code.toLowerCase();

      if (!grouped[key]) grouped[key] = { users: [], activeCount: 0 };
      grouped[key].users.push(user);
      if (user.subscriptionStatus === "active") {
        grouped[key].activeCount++;
      }
    });

    const affiliateStats = await Promise.all(
      Object.entries(grouped).map(async ([key, data]) => {
        // Resolve owner by referralCode first; if not found and key looks like ObjectId, try _id
        let owner =
          (await User.findOne({ referralCode: new RegExp(`^${escapeRegex(key)}$`, "i") }, { name: 1, email: 1 }).lean()) ||
          (mongoose.isValidObjectId(key)
            ? await User.findById(key, { name: 1, email: 1 }).lean()
            : null);

        const isHouse = HOUSE_CODES.has(key);

        const totalRevenueGenerated = Number((data.activeCount * PLAN_PRICE).toFixed(2));
        const payoutDue = isHouse ? 0 : data.activeCount * COMMISSION_PER_USER;

        return {
          name: isHouse ? "House" : (owner?.name || "Unknown"),
          email: isHouse ? "N/A" : (owner?.email || "N/A"),
          promoCode: key,
          totalRedemptions: data.users.length,
          totalRevenueGenerated,
          payoutDue,
        };
      })
    );

    affiliateStats.sort((a, b) => b.totalRedemptions - a.totalRedemptions);

    return res.status(200).json(affiliateStats);
  } catch (err) {
    console.error("Affiliate summary error:", err);
    return res.status(500).json({ error: "Failed to load affiliate data." });
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

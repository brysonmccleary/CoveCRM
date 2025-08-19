// /pages/api/affiliates/all.ts

import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const PLAN_PRICE = 199.99;
const COMMISSION_PER_USER = 25;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    await mongooseConnect();

    const allUsers = await User.find({
      referredBy: { $exists: true, $ne: null },
    });

    const grouped: {
      [code: string]: {
        users: typeof allUsers;
        activeCount: number;
      };
    } = {};

    allUsers.forEach((user) => {
      const code = user.referredBy!;
      if (!grouped[code]) grouped[code] = { users: [], activeCount: 0 };
      grouped[code].users.push(user);
      if (user.subscriptionStatus === "active") {
        grouped[code].activeCount++;
      }
    });

    const affiliateStats = await Promise.all(
      Object.entries(grouped).map(async ([code, data]) => {
        const owner = await User.findOne({ referralCode: code });

        return {
          name: owner?.name || "Unknown",
          email: owner?.email || "N/A",
          promoCode: code,
          totalRedemptions: data.users.length,
          totalRevenueGenerated: data.activeCount * PLAN_PRICE,
          payoutDue: data.activeCount * COMMISSION_PER_USER,
        };
      }),
    );

    // ✅ Sort by total redemptions, descending
    affiliateStats.sort((a, b) => b.totalRedemptions - a.totalRedemptions);

    return res.status(200).json(affiliateStats);
  } catch (err) {
    console.error("Affiliate summary error:", err);
    return res.status(500).json({ error: "Failed to load affiliate data." });
  }
}

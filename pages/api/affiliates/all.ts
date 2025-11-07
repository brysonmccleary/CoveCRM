import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const PLAN_PRICE = 199.99;
const COMMISSION_PER_USER = 25;

/**
 * Groups by the effective code a user used:
 * 1) preferred: referredByCode (new)
 * 2) fallback: legacy string in referredBy
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await mongooseConnect();

    const allUsers = await User.find({
      $or: [
        { referredByCode: { $exists: true, $ne: null } },
        { referredBy: { $exists: true, $ne: null } },
      ],
    }).lean();

    type Bucket = { users: any[]; activeCount: number };
    const grouped: Record<string, Bucket> = {};

    for (const user of allUsers) {
      const code =
        (typeof user.referredByCode === "string" && user.referredByCode) ||
        (typeof user.referredBy === "string" && user.referredBy) ||
        // if legacy referredBy was an ObjectId at some point, ignore it for grouping
        "";

      if (!code) continue;

      if (!grouped[code]) grouped[code] = { users: [], activeCount: 0 };
      grouped[code].users.push(user);
      if (user.subscriptionStatus === "active") grouped[code].activeCount++;
    }

    const affiliateStats = await Promise.all(
      Object.entries(grouped).map(async ([code, data]) => {
        // Owner is someone whose personal referralCode equals this code
        const owner = await User.findOne({ referralCode: code }).select({ name: 1, email: 1 }).lean();

        // House code handling — optional name override
        const isHouse =
          (process.env.HOUSE_CODES || "COVE50")
            .split(",")
            .map(s => s.trim().toLowerCase())
            .filter(Boolean)
            .includes(code.toLowerCase());

        return {
          name: isHouse ? "House" : owner?.name || "Unknown",
          email: isHouse ? "N/A"    : owner?.email || "N/A",
          promoCode: code,
          totalRedemptions: data.users.length,
          totalRevenueGenerated: Number((data.activeCount * PLAN_PRICE).toFixed(2)),
          payoutDue: isHouse ? 0 : data.activeCount * COMMISSION_PER_USER,
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

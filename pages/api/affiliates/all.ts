import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const PLAN_PRICE = 199.99;
const COMMISSION_PER_USER = 25;

function normalizeCode(s: string) {
  return s.trim().toUpperCase();
}

function getHouseSet() {
  return new Set(
    (process.env.HOUSE_CODES || "COVE50")
      .split(",")
      .map(s => s.trim().toUpperCase())
      .filter(Boolean)
  );
}

/**
 * Groups by the effective code a user used:
 * 1) preferred: referredByCode (new)
 * 2) fallback: legacy string in referredBy
 * All grouping keys are normalized to UPPERCASE to avoid dup rows.
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
    const houseSet = getHouseSet();

    for (const user of allUsers) {
      const rawCode =
        (typeof user.referredByCode === "string" && user.referredByCode) ||
        (typeof user.referredBy === "string" && user.referredBy) ||
        "";

      if (!rawCode) continue;

      const key = normalizeCode(rawCode); // 🔑 normalize to avoid cove50/COVE50 split

      if (!grouped[key]) grouped[key] = { users: [], activeCount: 0 };
      grouped[key].users.push(user);
      if (user.subscriptionStatus === "active") grouped[key].activeCount++;
    }

    const affiliateStats = await Promise.all(
      Object.entries(grouped).map(async ([key, data]) => {
        // Owner: someone whose personal referralCode equals this key (case-insensitive)
        const owner = await User.findOne({
          referralCode: new RegExp(`^${key}$`, "i"),
        })
          .select({ name: 1, email: 1 })
          .lean();

        const isHouse = houseSet.has(key);

        return {
          name: isHouse ? "House" : owner?.name || "Unknown",
          email: isHouse ? "N/A"    : owner?.email || "N/A",
          promoCode: key, // present normalized code consistently
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

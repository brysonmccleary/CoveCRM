import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";

function getHouseSet() {
  return new Set(
    (process.env.HOUSE_CODES || process.env.AFFILIATE_HOUSE_CODE || "COVE50")
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
  );
}

function U(s?: string | null) {
  return (s || "").trim().toUpperCase();
}

function adminEmailSet() {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = String(session?.user?.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!adminEmailSet().has(email)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  try {
    await mongooseConnect();

    const affiliates = await Affiliate.find({})
      .select({
        name: 1,
        email: 1,
        promoCode: 1,
        totalRedemptions: 1,
        totalRevenueGenerated: 1,
        payoutDue: 1,
      })
      .lean();

    const house = getHouseSet();

    const results = await Promise.all(
      (affiliates || []).map(async (a: any) => {
        const code = U(a.promoCode);
        let name = a.name || "";
        let email = a.email || "";
        if (!name || !email) {
          const owner = await User.findOne({
            referralCode: new RegExp(`^${code}$`, "i"),
          })
            .select({ name: 1, email: 1 })
            .lean();
          if (!name) name = owner?.name || "";
          if (!email) email = owner?.email || "";
        }

        const isHouse = house.has(code);

        return {
          name: isHouse ? "House" : name || "Unknown",
          email: isHouse ? "N/A" : email || "N/A",
          promoCode: code,
          totalRedemptions: Number(a.totalRedemptions || 0),
          totalRevenueGenerated: Number(a.totalRevenueGenerated || 0),
          payoutDue: isHouse ? 0 : Number(a.payoutDue || 0),
        };
      }),
    );

    results.sort((a, b) => b.totalRedemptions - a.totalRedemptions);
    return res.status(200).json(results);
  } catch (err) {
    console.error("Affiliate summary error:", err);
    return res.status(500).json({ error: "Failed to load affiliate data." });
  }
}

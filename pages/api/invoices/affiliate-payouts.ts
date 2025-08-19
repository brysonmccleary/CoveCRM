import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await User.findOne({ email: session.user.email });

    if (!user?.referralCode || !user.affiliateApproved) {
      return res.status(200).json({ payouts: [] });
    }

    const historyObj = user.commissionHistory || {};
    const historyArray = Object.entries(historyObj)
      .map(([month, value]) => ({ month, value }))
      .sort((a, b) => (a.month > b.month ? -1 : 1)); // Sort newest → oldest

    return res.status(200).json({
      payouts: [
        {
          totalEarned: user.totalReferralEarnings || 0,
          thisMonth: user.commissionThisMonth || 0,
          lastPayout: user.lastPayoutDate || null,
          history: historyArray,
        },
      ],
    });
  } catch (err) {
    console.error("[AFFILIATE_PAYOUTS_FETCH_ERROR]", err);
    return res.status(500).json({ error: "Failed to fetch affiliate payouts" });
  }
}

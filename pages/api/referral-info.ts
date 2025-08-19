// /pages/api/referral-info.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const affiliate = await Affiliate.findOne({ userId: user._id });

  res.status(200).json({
    referralCode: affiliate?.code || null,
    referredBy: user.referredBy || null,
    stripeLink: affiliate?.stripeLink || null,
    earned: affiliate?.earned || 0,
    paidOut: affiliate?.paidOut || 0,
  });
}

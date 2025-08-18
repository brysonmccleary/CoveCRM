// /pages/api/affiliate-track.ts
import { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { email, code } = req.body;

  if (req.method !== "POST") return res.status(405).end();

  await dbConnect();

  const referringUser = await User.findOne({ affiliateCode: code });
  if (!referringUser) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid referral code." });
  }

  await User.findOneAndUpdate(
    { email },
    {
      referredBy: code,
      referralDiscountApplied: true,
    },
  );

  res.status(200).json({ success: true });
}

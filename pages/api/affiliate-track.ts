// /pages/api/affiliate-track.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = normalizeEmail(session?.user?.email);

  if (!sessionEmail) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const { code } = req.body;

  await dbConnect();

  const referringUser = await User.findOne({ affiliateCode: code });
  if (!referringUser) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid referral code." });
  }

  const updated = await User.findOneAndUpdate(
    {
      email: sessionEmail,
      $or: [
        { referredBy: { $exists: false } },
        { referredBy: null },
        { referredBy: "" },
      ],
    },
    {
      referredBy: code,
      referralDiscountApplied: true,
    },
    { new: true },
  );

  if (!updated) {
    return res.status(409).json({
      success: false,
      message: "Referral already set or user not found.",
    });
  }

  res.status(200).json({ success: true });
}

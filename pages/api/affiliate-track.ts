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
  const isAdmin = Boolean(session?.user && (session.user as any).role === "admin");

  const { email, code } = req.body;
  const targetEmail = normalizeEmail(email);

  if (!sessionEmail || (!isAdmin && sessionEmail !== targetEmail)) {
    return res.status(403).json({ success: false, message: "Unauthorized" });
  }

  await dbConnect();

  const referringUser = await User.findOne({ affiliateCode: code });
  if (!referringUser) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid referral code." });
  }

  await User.findOneAndUpdate(
    { email: targetEmail },
    {
      referredBy: code,
      referralDiscountApplied: true,
    },
  );

  res.status(200).json({ success: true });
}

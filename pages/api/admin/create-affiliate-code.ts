import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import AffiliateCode from "@/models/AffiliateCode";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session || session.user.email !== "bryson.mccleary1@gmail.com") {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { referralCode, email } = req.body;

  if (!referralCode || !email) {
    return res.status(400).json({ message: "Missing fields" });
  }

  try {
    await dbConnect();

    const exists = await AffiliateCode.findOne({ referralCode });
    if (exists) {
      return res.status(400).json({ message: "Referral code already exists" });
    }

    const newCode = new AffiliateCode({ referralCode, email });
    await newCode.save();

    res.status(201).json({ message: "Affiliate code created successfully" });
  } catch (err) {
    console.error("Affiliate code creation error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

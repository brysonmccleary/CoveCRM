import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import AffiliateCode from "@/models/AffiliateCode";
import User from "@/models/User";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session || session.user.email !== "bryson.mccleary1@gmail.com") {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await dbConnect();

    const codes = await AffiliateCode.find().sort({ createdAt: -1 });

    const codeStats = await Promise.all(
      codes.map(async (code) => {
        const referredCount = await User.countDocuments({
          referralCodeUsed: code.referralCode,
        });

        return {
          _id: code._id,
          referralCode: code.referralCode,
          email: code.email,
          referredCount,
          createdAt: code.createdAt,
        };
      })
    );

    res.status(200).json({ codes: codeStats });
  } catch (err) {
    console.error("Error loading referral codes:", err);
    res.status(500).json({ message: "Internal server error" });
  }
}

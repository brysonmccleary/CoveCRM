// /pages/api/admin/get-affiliate-codes.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const adminEmail = session?.user?.email ?? null;
  if (adminEmail !== "bryson.mccleary1@gmail.com") {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const affiliates = await Affiliate.find(
    { promoCode: { $exists: true, $ne: "" } },
    { email: 1, promoCode: 1, totalRedemptions: 1, payoutDue: 1 },
  ).lean();

  const codes = (affiliates || []).map((a: any) => ({
    _id: String(a._id),
    email: a.email,
    referralCode: a.promoCode,
    referredCount: a.totalRedemptions ?? 0,
    payoutDue: a.payoutDue ?? 0,
  }));

  return res.status(200).json({ codes });
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userId = (session?.user as any)?.id;
  if (!session?.user?.email || !userId) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const affiliate = await Affiliate.findOne({ userId }).lean();
  if (!affiliate) return res.status(404).json({ error: "Affiliate record not found" });

  const referralCode = String((affiliate as any).referralCode || (affiliate as any).promoCode || "").trim();
  if (!referralCode) return res.status(404).json({ error: "Referral code not found" });

  return res.status(200).json({
    referralCode,
    referralLink: `https://covecrm.com/pricing-select?ref=${encodeURIComponent(referralCode)}`,
  });
}

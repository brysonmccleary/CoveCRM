import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const adminEmail = session?.user?.email ?? null;
  if (adminEmail !== "bryson.mccleary1@gmail.com") {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { email, promoCode } = (req.body || {}) as { email?: string; promoCode?: string };
  if (!email || !promoCode) return res.status(400).json({ message: "Missing email or promoCode" });

  const code = promoCode.trim().toUpperCase();
  if (!code) return res.status(400).json({ message: "Invalid promoCode" });

  await dbConnect();

  // Ensure code uniqueness against other affiliates
  const exists = await Affiliate.findOne({ promoCode: code, email: { $ne: email } }).lean();
  if (exists) return res.status(409).json({ message: "Promo code already in use" });

  const doc = await Affiliate.findOneAndUpdate(
    { email },
    { $setOnInsert: { email }, $set: { promoCode: code } },
    { new: true, upsert: true },
  );

  return res.status(200).json({ ok: true, affiliate: doc });
}

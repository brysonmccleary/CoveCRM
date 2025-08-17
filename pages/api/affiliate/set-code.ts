import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { code } = req.body;

  if (!code || typeof code !== "string") {
    return res.status(400).json({ error: "Missing or invalid code" });
  }

  await dbConnect();

  const normalizedCode = code.trim().toUpperCase();

  // Ensure the code is not already taken by another affiliate
  const existing = await Affiliate.findOne({ promoCode: normalizedCode });
  if (existing) {
    return res.status(409).json({ error: "Code already taken" });
  }

  // Create or update affiliate record
  let affiliate = await Affiliate.findOne({ email: session.user.email });
  if (!affiliate) {
    affiliate = await Affiliate.create({
      name: session.user.name || "Affiliate",
      email: session.user.email,
      promoCode: normalizedCode,
    });
  } else {
    affiliate.promoCode = normalizedCode;
    await affiliate.save();
  }

  // Also update the user's referralCode field
  await User.findOneAndUpdate(
    { email: session.user.email },
    { referralCode: normalizedCode }
  );

  return res.status(200).json({ success: true });
}

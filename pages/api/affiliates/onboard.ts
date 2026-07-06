// pages/api/affiliates/onboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

const BASE_URL =
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";
const RETURN_PATH =
  process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = normalizeEmail(session?.user?.email);
  if (!sessionEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  const affiliate = await Affiliate.findOne({ email: sessionEmail });
  if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

  if (!affiliate.stripeConnectId) {
    const acct = await stripe.accounts.create({
      type: "express",
      email: sessionEmail,
      capabilities: { transfers: { requested: true } },
      metadata: { affiliateEmail: sessionEmail },
    });
    affiliate.stripeConnectId = acct.id;
    await affiliate.save();
  }

  try {
    const link = await stripe.accountLinks.create({
      account: String(affiliate.stripeConnectId),
      refresh_url: `${BASE_URL}${RETURN_PATH}`,
      return_url: `${BASE_URL}${RETURN_PATH}`,
      type: "account_onboarding",
    });
    return res.status(200).json({ url: link.url });
  } catch (err: any) {
    console.error("Stripe onboarding link error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create onboarding link" });
  }
}

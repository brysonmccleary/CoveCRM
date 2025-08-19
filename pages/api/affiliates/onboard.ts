// pages/api/affiliates/onboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe"; // ✅ use shared client (no apiVersion literal)

const BASE_URL =
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";
const RETURN_PATH =
  process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // accept both GET ?email= and POST { email } to be backwards-friendly
  const email =
    (req.method === "POST"
      ? (req.body?.email as string | undefined)
      : undefined) ??
    (typeof req.query.email === "string" ? req.query.email : undefined);

  if (!email) return res.status(400).json({ error: "Missing email" });

  await mongooseConnect();

  const affiliate = await Affiliate.findOne({ email: email.toLowerCase() });
  if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

  // If they somehow don’t have a Connect account yet, create one now
  if (!affiliate.stripeConnectId) {
    const acct = await stripe.accounts.create({
      type: "express",
      email: email.toLowerCase(),
      capabilities: { transfers: { requested: true } },
      metadata: { affiliateEmail: email.toLowerCase() },
    });
    affiliate.stripeConnectId = acct.id;
    await affiliate.save();
  }

  // Create onboarding link
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

import { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email." });

    await mongooseConnect();
    const affiliate = await Affiliate.findOne({ email });
    if (!affiliate) return res.status(404).json({ error: "Affiliate not found." });

    // 1. Create Stripe Express Account
    const account = await stripe.accounts.create({
      type: "express",
      email: affiliate.email,
      capabilities: {
        transfers: { requested: true },
      },
    });

    // 2. Save account ID to affiliate
    affiliate.stripeConnectId = account.id;
    affiliate.stripeId = account.id; // ✅ Added for schema
    affiliate.connectedAccountStatus = "pending";
    await affiliate.save();

    const origin = req.headers.origin || process.env.NEXTAUTH_URL || "http://localhost:3000";

    // 3. Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      refresh_url: `${origin}/settings?stripe=refresh`,
      return_url: `${origin}/api/affiliates/confirm?email=${affiliate.email}`,
      type: "account_onboarding",
    });

    return res.status(200).json({ url: accountLink.url });
  } catch (err) {
    console.error("Stripe onboarding error:", err);
    return res.status(500).json({ error: "Server error during onboarding." });
  }
}

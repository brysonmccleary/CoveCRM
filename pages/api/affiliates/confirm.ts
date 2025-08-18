// pages/api/affiliates/confirm.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe"; // use shared Stripe client (no apiVersion literal)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Keep behavior simple: accept GET (same as before)
  const { email } = req.query;
  if (!email || typeof email !== "string") return res.status(400).end("Missing email");

  await mongooseConnect();

  const affiliate = await Affiliate.findOne({ email: email.toLowerCase() });
  if (!affiliate || !affiliate.stripeConnectId) return res.status(404).end("Affiliate not found");

  // Retrieve the connected account and update local flags
  try {
    const connectId = String(affiliate.stripeConnectId);
    const accountResp = await stripe.accounts.retrieve(connectId);
    const detailsSubmitted = Boolean((accountResp as any).details_submitted);

    if (detailsSubmitted) {
      affiliate.onboardingCompleted = true;
      affiliate.connectedAccountStatus = "verified";
      await affiliate.save();
    }

    // Redirect back to settings either way (matches original behavior)
    return res.redirect("/settings?connected=stripe");
  } catch (err) {
    console.error("Affiliate confirm error:", err);
    return res.status(500).end("Stripe account retrieval failed");
  }
}

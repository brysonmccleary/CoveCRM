import { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { email } = req.query;
  if (!email || typeof email !== "string") return res.status(400).end();

  await mongooseConnect();
  const affiliate = await Affiliate.findOne({ email });
  if (!affiliate || !affiliate.stripeConnectId) return res.status(404).end();

  const account = await stripe.accounts.retrieve(affiliate.stripeConnectId);

  if (account.details_submitted) {
    affiliate.onboardingCompleted = true;
    affiliate.connectedAccountStatus = "verified";
    await affiliate.save();
  }

  res.redirect("/settings?connected=stripe");
}

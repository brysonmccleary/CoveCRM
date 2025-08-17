import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();

  const affiliate = await Affiliate.findOne({ email: session.user.email });
  if (!affiliate || !affiliate.promoCode) {
    return res.status(404).json({ error: "Affiliate not set up yet" });
  }

  // Use existing account if available
  let stripeAccountId = affiliate.stripeConnectId;
  if (!stripeAccountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: affiliate.email,
      capabilities: {
        transfers: { requested: true },
      },
      business_type: "individual",
    });

    stripeAccountId = account.id;
    affiliate.stripeConnectId = stripeAccountId;
    await affiliate.save();
  }

  // Create onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_LINK_REFRESH_URL!,
    return_url: process.env.NEXT_PUBLIC_STRIPE_ACCOUNT_LINK_RETURN_URL!,
    type: "account_onboarding",
  });

  return res.status(200).json({ url: accountLink.url });
}

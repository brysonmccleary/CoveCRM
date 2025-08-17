// /pages/api/create-stripe-account.ts
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import Stripe from "stripe";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-08-16",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user?.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Create Stripe Connect Account if not already linked
  if (!user.stripeConnectId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: user.email,
    });
    user.stripeConnectId = account.id;
    await user.save();
  }

  // Generate onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: user.stripeConnectId!,
    refresh_url: "https://covecrm.com/settings",
    return_url: "https://covecrm.com/settings",
    type: "account_onboarding",
  });

  res.status(200).json({ url: accountLink.url });
}

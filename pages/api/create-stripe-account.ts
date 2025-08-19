import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
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
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "https://covecrm.com";

  const accountLink = await stripe.accountLinks.create({
    account: user.stripeConnectId!,
    refresh_url: `${base}/settings`,
    return_url: `${base}/settings`,
    type: "account_onboarding",
  });

  res.status(200).json({ url: accountLink.url });
}

// /pages/api/affiliate/refresh-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const affiliate = await Affiliate.findOne({ userId: user._id });
  if (!affiliate || !affiliate.stripeConnectId) {
    return res.status(400).json({ error: "No affiliate record or Stripe account" });
  }

  try {
    const acct = await stripe.accounts.retrieve(affiliate.stripeConnectId);
    const detailsSubmitted = Boolean((acct as any).details_submitted);
    const payoutsEnabled = Boolean((acct as any).payouts_enabled);
    const chargesEnabled = Boolean((acct as any).charges_enabled);

    affiliate.onboardingCompleted = detailsSubmitted;
    affiliate.connectedAccountStatus =
      payoutsEnabled || chargesEnabled ? "verified" : detailsSubmitted ? "pending" : "incomplete";
    await affiliate.save();

    return res.status(200).json({
      onboardingCompleted: affiliate.onboardingCompleted,
      connectedAccountStatus: affiliate.connectedAccountStatus,
      payoutsEnabled,
      chargesEnabled,
    });
  } catch (err: any) {
    const devMsg =
      process.env.NODE_ENV !== "production" && (err?.message || err?.error?.message);
    return res.status(500).json({ error: devMsg || "Failed to refresh status" });
  }
}

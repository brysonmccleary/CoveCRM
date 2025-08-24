import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { stripe } from "@/lib/stripe";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  const returnUrl = `${BASE_URL}${process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings"}`;

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Ensure an Affiliate doc exists for this user
    let affiliate = await Affiliate.findOne({ email: user.email });
    if (!affiliate) {
      // Build a unique promo code (fallback to email local part)
      const base = (user.referralCode || user.username || user.email.split("@")[0] || "AFF")
        .replace(/[^a-zA-Z0-9]/g, "")
        .substring(0, 12)
        .toUpperCase() || "AFF";
      let promoCode = base;
      let suffix = 0;
      while (await Affiliate.findOne({ promoCode })) {
        suffix += 1;
        promoCode = `${base}${suffix}`;
      }

      affiliate = await Affiliate.create({
        userId: user._id,
        name: user.name || user.email,
        email: user.email,
        promoCode,
        approved: !!user.affiliateApproved,
      });
    }

    // Create/reuse Stripe Connect account (Express) with transfers capability
    let connectId = affiliate.stripeConnectId;
    if (!connectId) {
      const account = await stripe.accounts.create({
        type: "express",
        email: affiliate.email,
        capabilities: { transfers: { requested: true } },
        business_type: "individual",
      });
      connectId = account.id;
      affiliate.stripeConnectId = connectId;
      affiliate.connectedAccountStatus = "pending";
      affiliate.onboardingCompleted = false as any; // tolerated by schema
      await affiliate.save();
    }

    // Generate onboarding link
    const link = await stripe.accountLinks.create({
      account: connectId!,
      refresh_url: returnUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return res.status(200).json({ url: link.url, stripeConnectId: connectId });
  } catch (e: any) {
    console.error("connect/start error:", e?.message || e);
    return res.status(500).json({ error: "Failed to create onboarding link" });
  }
}

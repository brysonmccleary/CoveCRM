import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }
  const requiredEnv = ["AI_Upgrade", "STRIPE_SECRET_KEY"];
  for (const key of requiredEnv) {
    if (!process.env[key]) {
      return res.status(500).json({ success: false, error: `Missing required env var: ${key}` });
    }
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ success: false, error: "User not found" });
    if ((user as any).role === "admin") {
      return res.status(200).json({ success: true, message: "AI features unlocked" });
    }
    if ((user as any).planCode !== "base") {
      return res.status(400).json({ success: false, error: "AI features are already included on your plan" });
    }
    if ((user as any).cardOnFile !== true) {
      return res.status(403).json({ success: false, error: "Please add a payment method before upgrading" });
    }

    const aiUpgradePriceId = process.env.AI_Upgrade || "";
    if (!aiUpgradePriceId) {
      return res.status(500).json({ success: false, error: "Missing AI upgrade price ID" });
    }

    const customerId = String((user as any).stripeCustomerId || (user as any).stripeCustomerID || "").trim();
    if (!customerId) {
      return res.status(400).json({ success: false, error: "Missing Stripe customer" });
    }

    let upgradeId = "";
    const baseSubscriptionId = String((user as any).stripeSubscriptionId || "").trim();

    assertStripeWritesEnabled();
    if (baseSubscriptionId) {
      const item = await stripe.subscriptionItems.create({
        subscription: baseSubscriptionId,
        price: aiUpgradePriceId,
        quantity: 1,
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
      } as any);
      upgradeId = item.id;
    } else {
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: aiUpgradePriceId, quantity: 1 }],
        metadata: {
          userId: String(user._id),
          planCode: "base",
          aiEntitlementSource: "upgrade",
        },
      });
      upgradeId = subscription.id;
    }

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          hasAI: true,
          aiEntitlementSource: "upgrade",
          aiUpgradeSubscriptionId: upgradeId,
        },
      },
    );

    return res.status(200).json({ success: true, message: "AI features unlocked" });
  } catch (err: any) {
    console.error("create-ai-upgrade error:", err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || "AI upgrade failed" });
  }
}

// pages/api/facebook/subscribe.ts
// POST — create Stripe subscription for Facebook Lead Manager plan
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import { stripe } from "@/lib/stripe";

const PLAN_PRICE_IDS: Record<string, string> = {
  manager: process.env.STRIPE_FB_MANAGER_PRICE_ID || "",
  manager_pro: process.env.STRIPE_FB_PRO_PRICE_ID || "",
};

const PLAN_NAMES: Record<string, string> = {
  manager: "Lead Manager",
  manager_pro: "Lead Manager Pro",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const { plan } = req.body as { plan?: string };
  if (!plan || !["manager", "manager_pro"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan. Must be 'manager' or 'manager_pro'." });
  }

  const priceId = PLAN_PRICE_IDS[plan];
  if (!priceId) {
    return res.status(500).json({ error: `Stripe price ID not configured for plan: ${plan}` });
  }

  await mongooseConnect();

  const user = await User.findOne({ email }).lean() as any;
  if (!user) return res.status(404).json({ error: "User not found" });

  // Check for existing active subscription
  const existing = await FBLeadSubscription.findOne({ userEmail: email, status: "active" }).lean();
  if (existing) {
    return res.status(409).json({
      error: "You already have an active Facebook Lead subscription.",
      plan: (existing as any).plan,
    });
  }

  const BASE_URL = (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : email,
      line_items: [{ price: priceId, quantity: 1 }],
      payment_method_types: ["card"],
      metadata: {
        userId: String(user._id),
        email,
        fbPlan: plan,
      },
      subscription_data: {
        metadata: {
          userId: String(user._id),
          email,
          fbPlan: plan,
        },
      },
      success_url: `${BASE_URL}/facebook-leads?subscribed=true&plan=${plan}`,
      cancel_url: `${BASE_URL}/facebook-leads`,
    });

    return res.status(200).json({ url: checkoutSession.url, plan, planName: PLAN_NAMES[plan] });
  } catch (err: any) {
    console.error("[facebook/subscribe] Stripe error:", err?.message);
    return res.status(500).json({ error: err?.message || "Checkout failed" });
  }
}

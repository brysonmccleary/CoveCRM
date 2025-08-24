import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).end("User not found");

  const { wantsUpgrade } = (req.body || {}) as { wantsUpgrade?: boolean };

  const BASE_PRICE = process.env.STRIPE_PRICE_ID_MONTHLY || "price_1RoAGJDF9aEsjVyJV2wARrFp";
  const AI_PRICE = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "price_1RoAK4DF9aEsjVyJeoR3w3RL";

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: BASE_PRICE, // base plan (e.g., $200/mo)
      quantity: 1,
    },
  ];

  if (wantsUpgrade) {
    line_items.push({
      price: AI_PRICE, // AI add-on (e.g., $50/mo)
      quantity: 1,
    });
  }

  const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      // Use an existing customer when possible to avoid dupes
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items,
      allow_promotion_codes: true,
      payment_method_types: ["card"],
      metadata: {
        userId: (user as any)?._id?.toString?.() || "",
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: (user as any)?.referredBy || "none",
      },
      success_url: `${BASE_URL}/success?paid=true`,
      cancel_url: `${BASE_URL}/upgrade`,
    });

    return res.status(200).json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error("❌ Stripe checkout error:", err);
    return res.status(500).json({ error: err?.message || "Checkout failed" });
  }
}

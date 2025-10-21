import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "http://localhost:3000";

/**
 * POST /api/billing/create-ai-checkout
 * Creates a Stripe Checkout session for the **AI SMS Automation** add-on.
 * Copy clarifies: "$50 monthly access fee + SMS usage" (no per-minute call fees).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY;
  if (!AI_PRICE_ID || !AI_PRICE_ID.startsWith("price_")) {
    return res.status(500).json({ error: "Missing STRIPE_PRICE_ID_AI_MONTHLY (Stripe price_... id)" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: user.stripeCustomerId || undefined,
      customer_email: user.stripeCustomerId ? undefined : user.email,
      line_items: [{ price: AI_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      payment_method_types: ["card"],

      // Make the positioning unambiguous in the hosted Checkout UI.
      custom_text: {
        submit: { message: "AI SMS Automation add-on will be enabled for this account." },
        after_submit: {
          message:
            "Thanks! The AI SMS Automation add-on includes a $50 monthly access fee + pay-as-you-go SMS usage. No recorded-call per-minute fees.",
        },
      },

      // Attach metadata at the subscription level for downstream entitlement/webhooks.
      subscription_data: {
        metadata: {
          product: "ai_sms_automation",
          userId: (user as any)?._id?.toString?.() || "",
          email: user.email,
          referralCodeUsed: (user as any)?.referredBy || "none",
          // Explicit copy we want the ops/CS team to see in Stripe:
          copy: "AI SMS Automation — $50 monthly access fee + SMS usage (no per-minute recorded-call fees)",
        },
        // Optional: description can help in Stripe UI; uncomment if you want it visible there.
        // description: "AI SMS Automation — $50 monthly access fee + SMS usage",
      },

      success_url: `${BASE_URL}/dashboard?tab=settings&ai=on`,
      cancel_url: `${BASE_URL}/dashboard?tab=settings`,
    });

    return res.status(200).json({ url: checkout.url });
  } catch (err: any) {
    console.error("❌ create-ai-checkout error:", err?.message || err);
    return res.status(500).json({ error: "Checkout failed" });
  }
}

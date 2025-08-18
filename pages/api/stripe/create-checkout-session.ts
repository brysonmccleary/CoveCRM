// /pages/api/stripe/create-checkout-session.ts

import { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { getUserByEmail } from "@/models/User";
import dbConnect from "@/lib/mongooseConnect";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  await dbConnect();
  const user = await getUserByEmail(session.user.email);
  if (!user) return res.status(404).end("User not found");

  const { wantsUpgrade } = req.body;

  const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: "price_1RoAGJDF9aEsjVyJV2wARrFp", // $200/month base
      quantity: 1,
    },
  ];

  if (wantsUpgrade) {
    line_items.push({
      price: "price_1RoAK4DF9aEsjVyJeoR3w3RL", // $50/month AI Upgrade
      quantity: 1,
    });
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription",
      customer_email: user.email,
      line_items,
      allow_promotion_codes: true,
      metadata: {
        userId: user._id.toString(),
        email: user.email,
        upgradeIncluded: wantsUpgrade ? "true" : "false",
        referralCodeUsed: user.referredBy || "none",
      },
      success_url: `${process.env.NEXTAUTH_URL}/success?paid=true`,
      cancel_url: `${process.env.NEXTAUTH_URL}/upgrade`,
    });

    return res.status(200).json({ url: checkoutSession.url });
  } catch (err: any) {
    console.error("❌ Stripe checkout error:", err);
    return res.status(500).json({ error: err.message });
  }
}

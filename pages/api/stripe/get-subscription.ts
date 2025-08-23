import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const AI_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_MONTHLY || "";

  if (!user.stripeCustomerId) {
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!user.hasAI, // reflects entitlement if we previously set it
    });
  }

  try {
    // Get all active/trialing subs and sum amounts
    const subs = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
    });

    let monthlyCents = 0;
    let hasAI = false;

    for (const sub of subs.data) {
      const activeLike = sub.status === "active" || sub.status === "trialing" || sub.status === "past_due";
      if (!activeLike) continue;

      for (const item of sub.items.data) {
        const price = item.price;
        if (price?.unit_amount) monthlyCents += price.unit_amount;
        if (price?.id === AI_PRICE_ID) hasAI = true;
      }
    }

    return res.status(200).json({
      amount: monthlyCents ? (monthlyCents / 100).toFixed(2) : null,
      hasAIUpgrade: hasAI || !!user.hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!user.hasAI,
    });
  }
}

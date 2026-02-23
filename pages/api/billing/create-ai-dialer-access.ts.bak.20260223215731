// pages/api/billing/create-ai-dialer-access.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

type ResponseBody =
  | { ok: true; url: string }
  | { ok: false; error: string };

// ✅ One upgrade: AI Suite price (use your existing AI monthly env)
const AI_SUITE_PRICE_ID =
  process.env.STRIPE_PRICE_ID_AI_MONTHLY ||
  process.env.STRIPE_PRICE_ID_AI_ADDON ||
  "";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>
) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  if (!AI_SUITE_PRICE_ID)
    return res.status(500).json({
      ok: false,
      error: "AI Suite price not configured (set STRIPE_PRICE_ID_AI_MONTHLY)",
    });

  try {
    const session = (await getServerSession(
      req,
      res,
      authOptions as any
    )) as { user?: { email?: string | null } } | null;

    if (!session?.user?.email)
      return res.status(401).json({ ok: false, error: "Not authenticated" });

    const email = String(session.user.email).toLowerCase();

    await mongooseConnect();
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ ok: false, error: "User not found for AI Suite checkout" });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: String(user._id) },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.NEXTAUTH_URL ||
      "http://localhost:3000";

    // ✅ Single-purpose checkout: AI Suite access (NO FREE MINUTES)
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: AI_SUITE_PRICE_ID, quantity: 1 }],
      payment_method_types: ["card"],
      allow_promotion_codes: true,
      metadata: {
        purpose: "ai_suite",
        userId: String(user._id),
        email,
      },
      success_url: `${baseUrl}/dashboard?tab=settings&ai=on`,
      cancel_url: `${baseUrl}/dashboard?tab=settings`,
    });

    return res.status(200).json({ ok: true, url: checkout.url! });
  } catch (err: any) {
    console.error("AI Suite checkout error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to start AI Suite checkout" });
  }
}

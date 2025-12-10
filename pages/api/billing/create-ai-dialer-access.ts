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

const PRICE_ID = process.env.AI_DIALER_ACCESS_PRICE_ID || "";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseBody>
) {
  if (req.method !== "POST")
    return res.status(405).json({ ok: false, error: "Method not allowed" });

  if (!PRICE_ID)
    return res
      .status(500)
      .json({ ok: false, error: "AI Dialer access price not configured" });

  try {
    const session = await getServerSession(req, res, authOptions as any);
    if (!session?.user?.email)
      return res.status(401).json({ ok: false, error: "Not authenticated" });

    const email = String(session.user.email).toLowerCase();

    await mongooseConnect();
    const user = await User.findOne({ email });
    if (!user)
      return res
        .status(404)
        .json({ ok: false, error: "User not found for AI Dialer access" });

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

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      payment_method_types: ["card"],
      metadata: {
        purpose: "ai_dialer_access",
        giveInitialCredit: "true",
        userId: String(user._id),
        email,
      },
      success_url: `${process.env.NEXTAUTH_URL}/settings?tab=billing&aiDialer=activated`,
      cancel_url: `${process.env.NEXTAUTH_URL}/settings?tab=billing&aiDialer=cancelled`,
    });

    return res.status(200).json({ ok: true, url: checkout.url! });
  } catch (err: any) {
    console.error("AI Dialer access error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to start AI Dialer checkout" });
  }
}

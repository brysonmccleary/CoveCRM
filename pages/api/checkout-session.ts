import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  // Price is never accepted from the client — always resolved server-side
  // from a fixed Stripe price ID, matching the pattern used by
  // pages/api/stripe/create-checkout-session.ts and create-ai-checkout.ts.
  const PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY;
  if (!PRICE_ID || !PRICE_ID.startsWith("price_")) {
    return res.status(500).json({ message: "Missing STRIPE_PRICE_ID_MONTHLY (Stripe price_... id)" });
  }

  try {
    assertStripeWritesEnabled();
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: email,
      line_items: [{ price: PRICE_ID, quantity: 1 }],
      success_url: `${req.headers.origin}/success?email=${encodeURIComponent(
        email,
      )}`,
      cancel_url: `${req.headers.origin}/billing?email=${encodeURIComponent(
        email,
      )}`,
    });

    return res.status(200).json({ url: checkoutSession.url });
  } catch (err) {
    console.error("Stripe Checkout Error:", err);
    return res.status(500).json({ message: "Stripe checkout failed" });
  }
}

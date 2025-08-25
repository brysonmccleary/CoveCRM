// /pages/api/create-stripe-portal.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();

    const user: any = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Support self-billed users via Stripe Connect (if you store a connected account id)
    const stripeAccount: string | undefined =
      user.billingStripeAccountId || user.stripeAccountId || user.stripeConnectId || undefined;

    // Reuse saved customer when available
    let customerId: string | undefined = user.stripeCustomerId || undefined;

    // If missing, try to find an existing customer by email (idempotent; avoids dupes)
    if (!customerId) {
      try {
        // Prefer Search API for accuracy
        const search = await stripe.customers.search(
          { query: `email:'${email}'` },
          stripeAccount ? { stripeAccount } : undefined
        );
        if (search?.data?.length) {
          customerId = search.data[0].id;
        } else {
          // Fallback to list filter if Search not enabled
          const list = await stripe.customers.list(
            { email, limit: 1 },
            stripeAccount ? { stripeAccount } : undefined
          );
          if (list?.data?.length) customerId = list.data[0].id;
        }

        if (customerId) {
          await User.updateOne({ email }, { $set: { stripeCustomerId: customerId } });
          user.stripeCustomerId = customerId;
        }
      } catch (lookupErr) {
        // Non-fatal; we handle "no customer" below
        console.error("Stripe customer lookup error:", lookupErr);
      }
    }

    // If still no customer, ask the user to start checkout instead of creating a new customer here
    if (!customerId) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(409).json({
        error:
          "No Stripe customer is linked to your account yet. Please start a subscription first, then open the billing portal.",
        needsCheckout: true,
      });
    }

    // Build a safe return URL (envs first; derive from request as a last resort)
    const baseUrl =
      process.env.STRIPE_CUSTOMER_PORTAL_RETURN_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.NEXTAUTH_URL ||
      `${(req.headers["x-forwarded-proto"] as string) || "https"}://${req.headers.host}`;

    const returnUrl = `${baseUrl.replace(/\/$/, "")}/settings?tab=billing`;

    const portal = await stripe.billingPortal.sessions.create(
      {
        customer: customerId,
        return_url: returnUrl,
      },
      stripeAccount ? { stripeAccount } : undefined
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ url: portal.url });
  } catch (err: any) {
    console.error("❌ create-portal error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
}

// /pages/api/create-stripe-portal.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

/**
 * Creates a short-lived Stripe Customer Portal session.
 * - Searches for the customer in BOTH contexts (connected account, then platform),
 *   and opens the portal in the context where the customer actually exists.
 * - If no customer is found, returns 409 { needsCheckout: true }.
 * - Idempotently saves stripeCustomerId on the user when found.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();

    const user: any = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Potential connected account (self-billed) indicator(s)
    const connectedAccount: string | undefined =
      user.billingStripeAccountId || user.stripeAccountId || user.stripeConnectId || undefined;

    // Helper to find a customer by email within a specific Stripe account context
    const findCustomerInContext = async (
      acct?: string
    ): Promise<{ id?: string } | null> => {
      try {
        // Prefer Search API
        const search = await stripe.customers.search(
          { query: `email:'${email}'` },
          acct ? { stripeAccount: acct } : undefined
        );
        if (search?.data?.length) return { id: search.data[0].id };

        // Fallback to list
        const list = await stripe.customers.list(
          { email, limit: 1 },
          acct ? { stripeAccount: acct } : undefined
        );
        if (list?.data?.length) return { id: list.data[0].id };
        return null;
      } catch (err) {
        // Non-fatal; return null to allow fallback to other context
        console.error("Stripe customer lookup error (context=", acct || "platform", "):", err);
        return null;
      }
    };

    // 1) If user already has a saved customer id, try to detect its context by fetching it
    let customerId: string | undefined = user.stripeCustomerId || undefined;
    let portalContext: "connected" | "platform" | null = null;

    const verifyCustomerInContext = async (id: string, acct?: string) => {
      try {
        await stripe.customers.retrieve(id, acct ? { stripeAccount: acct } : undefined);
        return true;
      } catch {
        return false;
      }
    };

    if (customerId) {
      // First try connected acct (if any), then platform
      if (connectedAccount && (await verifyCustomerInContext(customerId, connectedAccount))) {
        portalContext = "connected";
      } else if (await verifyCustomerInContext(customerId)) {
        portalContext = "platform";
      } else {
        // Saved id invalid in both contexts; unset to re-discover below
        customerId = undefined;
      }
    }

    // 2) No valid saved id → search by email in connected account then platform
    if (!customerId) {
      if (connectedAccount) {
        const c1 = await findCustomerInContext(connectedAccount);
        if (c1?.id) {
          customerId = c1.id;
          portalContext = "connected";
        }
      }
      if (!customerId) {
        const c2 = await findCustomerInContext(undefined);
        if (c2?.id) {
          customerId = c2.id;
          portalContext = "platform";
        }
      }
      if (customerId) {
        await User.updateOne({ email }, { $set: { stripeCustomerId: customerId } });
        user.stripeCustomerId = customerId;
      }
    }

    // 3) Still nothing → ask user to start checkout (avoid creating dupes here)
    if (!customerId || !portalContext) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(409).json({
        error:
          "No Stripe customer is linked to your account yet. Please start a subscription first, then open the billing portal.",
        needsCheckout: true,
      });
    }

    // Build a safe return URL
    const baseUrl =
      process.env.STRIPE_CUSTOMER_PORTAL_RETURN_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.NEXTAUTH_URL ||
      `${(req.headers["x-forwarded-proto"] as string) || "https"}://${req.headers.host}`;

    const returnUrl = `${baseUrl.replace(/\/$/, "")}/settings?tab=billing`;

    // 4) Create portal session in the context where the customer actually exists
    const portal = await stripe.billingPortal.sessions.create(
      {
        customer: customerId,
        return_url: returnUrl,
      },
      portalContext === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ url: portal.url });
  } catch (err: any) {
    console.error("❌ create-stripe-portal error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
}

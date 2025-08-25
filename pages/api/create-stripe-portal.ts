// /pages/api/create-stripe-portal.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

type Ctx = "platform" | "connected";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();

    const user: any = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // If you store a connected account id for self-billed users, it may be one of these:
    const connectedAccount: string | undefined =
      user.billingStripeAccountId || user.stripeAccountId || user.stripeConnectId || undefined;

    // Helper: get safe return URL
    const baseUrl =
      process.env.STRIPE_CUSTOMER_PORTAL_RETURN_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.NEXTAUTH_URL ||
      `${(req.headers["x-forwarded-proto"] as string) || "https"}://${req.headers.host}`;
    const returnUrl = `${baseUrl.replace(/\/$/, "")}/settings?tab=billing`;

    // --- helpers -------------------------------------------------------------

    const retrieveCustomer = async (id: string, ctx: Ctx): Promise<boolean> => {
      try {
        await stripe.customers.retrieve(id, ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined);
        return true;
      } catch {
        return false;
      }
    };

    const findCustomerByEmail = async (ctx: Ctx): Promise<string | undefined> => {
      try {
        // Prefer Search API
        const search = await stripe.customers.search(
          { query: `email:'${email}'` },
          ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
        );
        if (search?.data?.length) return search.data[0].id;

        // Fallback: list
        const list = await stripe.customers.list(
          { email, limit: 1 },
          ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
        );
        if (list?.data?.length) return list.data[0].id;
        return undefined;
      } catch (err) {
        console.error(`Stripe customer lookup error (${ctx})`, err);
        return undefined;
      }
    };

    const createCustomer = async (ctx: Ctx): Promise<string> => {
      const params = {
        email,
        metadata: { userId: (user as any)?._id?.toString?.() || "" },
      };
      const cust = await stripe.customers.create(
        params as any,
        ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
      );
      return cust.id;
    };

    const createPortal = async (customerId: string, ctx: Ctx) => {
      return stripe.billingPortal.sessions.create(
        {
          customer: customerId,
          return_url: returnUrl,
        },
        ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
      );
    };

    // --- strategy ------------------------------------------------------------
    // Your checkout session endpoint bills on the PLATFORM account,
    // so prefer platform context first. Fall back to connected if needed.

    let contextToUse: Ctx = "platform";
    let customerId: string | undefined = user.stripeCustomerId || undefined;

    // If we have a saved customer, validate it in platform then connected.
    if (customerId) {
      if (await retrieveCustomer(customerId, "platform")) {
        contextToUse = "platform";
      } else if (connectedAccount && (await retrieveCustomer(customerId, "connected"))) {
        contextToUse = "connected";
      } else {
        // Saved id invalid in both → forget it and rediscover
        customerId = undefined;
      }
    }

    // No valid saved id → try to find by email (platform first, then connected)
    if (!customerId) {
      customerId = await findCustomerByEmail("platform");
      if (customerId) {
        contextToUse = "platform";
      } else if (connectedAccount) {
        const foundConnected = await findCustomerByEmail("connected");
        if (foundConnected) {
          customerId = foundConnected;
          contextToUse = "connected";
        }
      }
    }

    // Still nothing → create a **platform** customer so portal always works (even if comped)
    if (!customerId) {
      customerId = await createCustomer("platform");
      contextToUse = "platform";
    }

    // Persist idempotently
    if (customerId && user.stripeCustomerId !== customerId) {
      await User.updateOne({ email }, { $set: { stripeCustomerId: customerId } });
      user.stripeCustomerId = customerId;
    }

    // Try creating the portal in the chosen context.
    // If connected-account portal fails (common when Billing Portal not enabled), automatically fall back to platform.
    try {
      const portal = await createPortal(customerId!, contextToUse);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ url: portal.url });
    } catch (err: any) {
      // If we tried connected and it failed, fall back to platform by ensuring a platform customer exists.
      console.error(`Portal creation error (${contextToUse})`, err?.message || err);
      if (contextToUse === "connected") {
        // Ensure we have a platform customer id (could be different)
        let platformCustomerId: string | undefined = await findCustomerByEmail("platform");
        if (!platformCustomerId) {
          platformCustomerId = await createCustomer("platform");
        }
        if (platformCustomerId && platformCustomerId !== user.stripeCustomerId) {
          await User.updateOne({ email }, { $set: { stripeCustomerId: platformCustomerId } });
          user.stripeCustomerId = platformCustomerId;
        }
        const portal = await createPortal(user.stripeCustomerId!, "platform");
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ url: portal.url });
      }
      // Platform failed for some other reason
      throw err;
    }
  } catch (err: any) {
    console.error("❌ create-stripe-portal fatal error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create portal session" });
  }
}

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

  // Optional: append ?debug=1 to surface more details in the JSON (still requires auth)
  const DEBUG = req.query.debug === "1";

  try {
    await dbConnect();

    const user: any = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const connectedAccount: string | undefined =
      user.billingStripeAccountId || user.stripeAccountId || user.stripeConnectId || undefined;

    const baseUrl =
      process.env.STRIPE_CUSTOMER_PORTAL_RETURN_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.NEXTAUTH_URL ||
      `${(req.headers["x-forwarded-proto"] as string) || "https"}://${req.headers.host}`;

    // Match your earlier behavior/path
    const returnUrl = `${baseUrl.replace(/\/$/, "")}/dashboard?tab=settings`;

    // ---- helpers ------------------------------------------------------------

    const retrieveCustomer = async (id: string, ctx: Ctx): Promise<boolean> => {
      try {
        await stripe.customers.retrieve(
          id,
          ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
        );
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
        if (DEBUG) console.error(`Stripe customer lookup error (${ctx})`, err);
        return undefined;
      }
    };

    const ensurePlatformCustomer = async (): Promise<string> => {
      // 1) reuse saved
      if (user.stripeCustomerId && (await retrieveCustomer(user.stripeCustomerId, "platform"))) {
        return user.stripeCustomerId;
      }
      // 2) find by email
      const found = await findCustomerByEmail("platform");
      if (found) {
        if (found !== user.stripeCustomerId) {
          await User.updateOne({ email }, { $set: { stripeCustomerId: found } });
          user.stripeCustomerId = found;
        }
        return found;
      }
      // 3) create new
      const created = await stripe.customers.create({
        email,
        metadata: { userId: (user as any)?._id?.toString?.() || "" },
      });
      await User.updateOne({ email }, { $set: { stripeCustomerId: created.id } });
      user.stripeCustomerId = created.id;
      return created.id;
    };

    const createPortal = async (customerId: string, ctx: Ctx) => {
      return stripe.billingPortal.sessions.create(
        { customer: customerId, return_url: returnUrl },
        ctx === "connected" && connectedAccount ? { stripeAccount: connectedAccount } : undefined
      );
    };

    // ---- strategy -----------------------------------------------------------
    // Prefer the context where a valid customer actually lives.
    // If connected fails (portal not enabled, etc.), fall back to platform.

    let contextToUse: Ctx = "platform";
    let customerId: string | undefined = user.stripeCustomerId || undefined;

    // Validate saved id
    if (customerId) {
      if (await retrieveCustomer(customerId, "platform")) {
        contextToUse = "platform";
      } else if (connectedAccount && (await retrieveCustomer(customerId, "connected"))) {
        contextToUse = "connected";
      } else {
        customerId = undefined;
      }
    }

    // If none, try to discover in connected, then platform
    if (!customerId && connectedAccount) {
      const inConnected = await findCustomerByEmail("connected");
      if (inConnected) {
        customerId = inConnected;
        contextToUse = "connected";
      }
    }
    if (!customerId) {
      const inPlatform = await findCustomerByEmail("platform");
      if (inPlatform) {
        customerId = inPlatform;
        contextToUse = "platform";
      }
    }

    // Still none → guarantee a platform customer so owner/admin can manage payment methods
    if (!customerId) {
      customerId = await ensurePlatformCustomer();
      contextToUse = "platform";
    }

    // Try portal in chosen context; if connected fails, fall back to platform
    try {
      const portal = await createPortal(customerId, contextToUse);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ url: portal.url, ctx: contextToUse });
    } catch (err: any) {
      const code = err?.code || err?.raw?.code;
      const message = err?.message || err?.raw?.message || "Portal create failed";
      if (DEBUG) console.error(`Portal creation error (${contextToUse})`, err);

      // If connected failed (common: portal not enabled on connected), fall back to platform.
      if (contextToUse === "connected") {
        try {
          const platformCustomer = await ensurePlatformCustomer();
          const portal = await createPortal(platformCustomer, "platform");
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).json({ url: portal.url, ctx: "platform", note: "fell_back_from_connected" });
        } catch (err2: any) {
          if (DEBUG) console.error("Platform fallback also failed:", err2);
          return res.status(500).json({
            error: "Failed to create portal session",
            reason: err2?.message || err2?.raw?.message || message,
            code: err2?.code || err2?.raw?.code || code,
          });
        }
      }

      // Platform failed
      return res.status(500).json({
        error: "Failed to create portal session",
        reason: message,
        code,
      });
    }
  } catch (err: any) {
    if (DEBUG) console.error("❌ create-stripe-portal fatal error:", err);
    return res.status(500).json({ error: "Failed to create portal session", reason: err?.message || "Unknown error" });
  }
}

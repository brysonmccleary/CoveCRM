import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import type Stripe from "stripe";

const ACTIVATION_ENFORCEMENT_STARTED_AT = new Date(
  process.env.ACCOUNT_ACTIVATION_ENFORCEMENT_STARTED_AT || "2026-04-10T00:00:00.000Z"
).getTime();

type PlanCode = "base" | "ai";
type BillingInterval = "monthly" | "annual";

function isLegacyBillingAccount(user: any) {
  const createdAt = user?.createdAt ? new Date(user.createdAt).getTime() : 0;
  return Boolean(createdAt && createdAt < ACTIVATION_ENFORCEMENT_STARTED_AT);
}

function normalizePlanCode(value: unknown): PlanCode {
  return value === "ai" ? "ai" : "base";
}

function normalizeInterval(value: unknown): BillingInterval {
  return value === "annual" ? "annual" : "monthly";
}

function getPriceId(planCode: PlanCode, interval: BillingInterval): string {
  if (planCode === "base" && interval === "monthly") return process.env.CoveCRM_Base || "";
  if (planCode === "base" && interval === "annual") return process.env.CoveCRM_Annual_Base_Plan || "";
  if (planCode === "ai" && interval === "monthly") return process.env.CoveCRM_AI_Plan || "";
  return process.env.CoveCRM_AI_Annual_Plan || "";
}

function requireEnv(res: NextApiResponse, keys: string[]) {
  for (const key of keys) {
    if (!process.env[key]) {
      res.status(500).json({ error: `Missing required env var: ${key}` });
      return false;
    }
  }
  return true;
}

async function ensureStripeCustomer(userDoc: any, email: string): Promise<string> {
  let cid: string | null = userDoc?.stripeCustomerId || userDoc?.stripeCustomerID || null;

  if (cid) {
    try {
      const existing = await stripe.customers.retrieve(cid);
      if ((existing as any)?.id) return cid;
    } catch (err: any) {
      const msg = String(err?.message || "").toLowerCase();
      const missing =
        err?.type === "StripeInvalidRequestError" ||
        msg.includes("no such customer") ||
        msg.includes("resource_missing");
      if (!missing) throw err;
    }
  }

  const created = await stripe.customers.create({
    email,
    metadata: { userId: String(userDoc?._id || "") },
  });

  if (userDoc) {
    userDoc.stripeCustomerId = created.id;
    if (typeof userDoc.set === "function") userDoc.set("stripeCustomerId", created.id);
    await userDoc.save();
  }
  return created.id;
}

function getRemainingTrialDays(userDoc: any): number {
  const trialEndsAt = userDoc?.trialEndsAt ? new Date(userDoc.trialEndsAt).getTime() : 0;
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86400000));
}

async function createSetupIntent(customerId: string, userId: string, subscriptionId: string, email: string) {
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card"],
    usage: "off_session",
    metadata: {
      userId,
      subscriptionId,
      email,
    },
  });
  return setupIntent.client_secret || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");
  if (!requireEnv(res, [
    "CoveCRM_Base",
    "CoveCRM_AI_Plan",
    "CoveCRM_AI_Annual_Plan",
    "CoveCRM_Annual_Base_Plan",
    "STRIPE_SECRET_KEY",
  ])) return;

  const { email: bodyEmail, affiliateEmail, planCode: bodyPlanCode, interval: bodyInterval } = (req.body || {}) as {
    email?: string;
    affiliateEmail?: string;
    planCode?: string;
    interval?: string;
  };

  try {
    await dbConnect();

    const session = await getServerSession(req, res, authOptions);
    const effectiveEmail = (session?.user?.email || bodyEmail || "").toLowerCase().trim();
    if (!effectiveEmail) return res.status(400).json({ error: "Missing email." });

    const userDoc = await User.findOne({ email: effectiveEmail });
    if (!userDoc) return res.status(404).json({ error: "User not found." });
    if (
      (userDoc as any).role !== "admin" &&
      (userDoc as any).emailVerified !== true &&
      !isLegacyBillingAccount(userDoc)
    ) {
      return res.status(403).json({ error: "Account not activated" });
    }

    const planCode = normalizePlanCode(bodyPlanCode || (userDoc as any).planCode);
    const interval = normalizeInterval(bodyInterval || (userDoc as any).billingInterval);
    const selectedPriceId = getPriceId(planCode, interval);

    if (!selectedPriceId) {
      return res.status(500).json({ error: `Missing Stripe price ID for ${planCode} ${interval}.` });
    }

    const customerId = await ensureStripeCustomer(userDoc, effectiveEmail);
    const userIdMeta = userDoc?._id?.toString() || "";
    const remainingDays = getRemainingTrialDays(userDoc);

    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
      expand: ["data.latest_invoice.payment_intent", "data.latest_invoice.setup_intent"],
    });

    const reusable = existingSubs.data.find((sub) =>
      ["incomplete", "trialing", "active", "past_due"].includes(sub.status)
    );

    if (reusable) {
      const latest = reusable.latest_invoice as any;
      const existingClientSecret = latest?.payment_intent?.client_secret || null;
      let existingSetupSecret = latest?.setup_intent?.client_secret || null;

      if (!existingClientSecret && !existingSetupSecret) {
        existingSetupSecret = await createSetupIntent(customerId, userIdMeta, reusable.id, effectiveEmail);
      }

      await User.updateOne(
        { _id: userDoc._id },
        {
          $set: {
            stripePriceId: selectedPriceId,
            stripeSubscriptionId: reusable.id,
            billingInterval: interval,
            planCode,
            hasAI: planCode === "ai",
            aiEntitlementSource: planCode === "ai" ? "plan" : "none",
          },
        },
      );

      return res.status(200).json({
        clientSecret: existingClientSecret,
        setupClientSecret: existingSetupSecret,
        subscriptionId: reusable.id,
        reused: true,
      });
    }

    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items: [{ price: selectedPriceId, quantity: 1 }],
      payment_behavior: "default_incomplete",
      metadata: {
        userId: userIdMeta,
        affiliateEmail: affiliateEmail || "",
        planCode,
        billingInterval: interval,
      },
      expand: ["latest_invoice.payment_intent"],
    };

    if (remainingDays > 0) {
      params.trial_period_days = remainingDays;
    }

    const subscription = await stripe.subscriptions.create(params, {
      idempotencyKey: `sub_${customerId}_${selectedPriceId}`,
    });

    await User.updateOne(
      { _id: userDoc._id },
      {
        $set: {
          stripePriceId: selectedPriceId,
          stripeSubscriptionId: subscription.id,
          billingInterval: interval,
          planCode,
          hasAI: planCode === "ai",
          aiEntitlementSource: planCode === "ai" ? "plan" : "none",
        },
      },
    );

    const latest = subscription.latest_invoice as Stripe.Invoice | null;
    const clientSecret =
      (latest && (latest as any).payment_intent && (latest as any).payment_intent.client_secret) || null;

    let setupClientSecret: string | null = null;
    if (!clientSecret) {
      setupClientSecret = await createSetupIntent(customerId, userIdMeta, subscription.id, effectiveEmail);
    }

    return res.status(200).json({
      clientSecret,
      setupClientSecret,
      subscriptionId: subscription.id,
    });
  } catch (err: any) {
    console.error("Stripe subscription error:", err);
    return res.status(500).json({ error: err?.message || "Subscription creation failed" });
  }
}

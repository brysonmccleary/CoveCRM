import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import type Stripe from "stripe";

// UI helper numbers only (kept from your version)
const BASE_PRICE = 199.99;
const AI_ADDON_PRICE = 50;

// Use env price IDs so they’re always correct for your current Stripe account
const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY as string; // required
const AI_ADDON_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_ADDON || ""; // optional

async function ensureStripeCustomer(userDoc: any, email: string): Promise<string> {
  let cid: string | null = userDoc?.stripeCustomerId || userDoc?.stripeCustomerID || null;

  if (cid) {
    try {
      const existing = await stripe.customers.retrieve(cid);
      if ((existing as any)?.id) return cid;
    } catch (err: any) {
      const msg = String(err?.message || "").toLowerCase();
      const missing =
        err?.type === "StripeInvalidRequestError" || msg.includes("no such customer") || msg.includes("resource_missing");
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

// ---------- Robust discount resolvers ----------
async function resolvePromotionCodeId(codeText: string): Promise<string | null> {
  const exact = await stripe.promotionCodes.list({ code: codeText, active: true, limit: 1 });
  if (exact.data?.[0]?.id) return exact.data[0].id;

  const page = await stripe.promotionCodes.list({ active: true, limit: 100 });
  const lc = codeText.toLowerCase();
  const found = page.data.find((p) => (p.code || "").toLowerCase() === lc);
  return found?.id || null;
}

async function resolveCouponId(codeText: string): Promise<string | null> {
  try {
    const byId = await stripe.coupons.retrieve(codeText);
    if ((byId as any)?.id) return byId.id;
  } catch { /* ignore */ }

  const page = await stripe.coupons.list({ limit: 100 });
  const lc = codeText.toLowerCase();
  const found = page.data.find((c) => (c.name || "").toLowerCase() === lc);
  return found?.id || null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const { email: bodyEmail, aiUpgrade, affiliateEmail, promoCode, trialDays } = (req.body || {}) as {
    email?: string;
    aiUpgrade?: boolean;
    affiliateEmail?: string;
    promoCode?: string;
    trialDays?: number;
  };

  try {
    await dbConnect();

    const session = await getServerSession(req, res, authOptions);
    const effectiveEmail = (session?.user?.email || bodyEmail || "").toLowerCase().trim();
    if (!effectiveEmail) return res.status(400).json({ error: "Missing email." });

    const userDoc = await User.findOne({ email: effectiveEmail });

    const customerId = await ensureStripeCustomer(userDoc, effectiveEmail);

    const totalBeforeDiscount = BASE_PRICE + (aiUpgrade ? AI_ADDON_PRICE : 0);

    // Prefer the promoCode passed from UI, otherwise fall back to user’s stored code
    const enteredCode = (promoCode || (userDoc as any)?.usedCode || (userDoc as any)?.referredByCode || "").trim();

    // Resolve discount object for the subscription
    let promotionCodeId: string | undefined;
    let couponId: string | undefined;

    if (enteredCode) {
      const pcId = await resolvePromotionCodeId(enteredCode);
      if (pcId) {
        promotionCodeId = pcId;
      } else {
        const cId = await resolveCouponId(enteredCode);
        if (cId) couponId = cId;
      }
    }

    // Compute display discount for response (best-effort)
    let discountAmount = 0;
    let discountLabel: string | null = null;
    if (promotionCodeId) {
      const pc = await stripe.promotionCodes.retrieve(promotionCodeId);
      const coupon = typeof pc.coupon === "string" ? await stripe.coupons.retrieve(pc.coupon) : pc.coupon;
      if ((coupon as any).amount_off) {
        discountAmount = (coupon as any).amount_off / 100;
        discountLabel = `$${discountAmount.toFixed(2)} off`;
      } else if ((coupon as any).percent_off) {
        discountAmount = totalBeforeDiscount * ((coupon as any).percent_off / 100);
        discountLabel = `${(coupon as any).percent_off}% off`;
      }
    } else if (couponId) {
      const coupon = await stripe.coupons.retrieve(couponId);
      if ((coupon as any).amount_off) {
        discountAmount = (coupon as any).amount_off / 100;
        discountLabel = `$${discountAmount.toFixed(2)} off`;
      } else if ((coupon as any).percent_off) {
        discountAmount = totalBeforeDiscount * ((coupon as any).percent_off / 100);
        discountLabel = `${(coupon as any).percent_off}% off`;
      }
    }

    const totalAfterDiscount = Math.max(totalBeforeDiscount - discountAmount, 0);

    if (!BASE_PRICE_ID) return res.status(500).json({ error: "Missing STRIPE_PRICE_ID_MONTHLY env." });

    const items: Stripe.SubscriptionCreateParams.Item[] = [{ price: BASE_PRICE_ID, quantity: 1 }];
    if (aiUpgrade && AI_ADDON_PRICE_ID) items.push({ price: AI_ADDON_PRICE_ID, quantity: 1 });

    const referralCodeUsed = enteredCode ? enteredCode.toUpperCase() : "none";
    const userIdMeta = userDoc?._id?.toString() || "";

    const params: Stripe.SubscriptionCreateParams = {
      customer: customerId,
      items,
      payment_behavior: "default_incomplete",
      metadata: {
        userId: userIdMeta,
        referralCodeUsed,
        affiliateEmail: affiliateEmail || "",
        aiUpgrade: aiUpgrade ? "true" : "false",
        appliedPromoCode: enteredCode || "",
      },
      expand: ["latest_invoice.payment_intent"],
    };

    // Trial enforcement (ONLY when UI requests trial)
    const trialDaysNum = typeof trialDays === "number" ? trialDays : Number(trialDays || 0);
    if (trialDaysNum > 0) {
      // Do NOT charge the base subscription until trial ends.
      (params as any).trial_period_days = trialDaysNum;
    }


    // Attach discount at subscription-time (Stripe-preferred, works with product-restricted coupons)
    if (promotionCodeId) {
      params.discounts = [{ promotion_code: promotionCodeId }];
    } else if (couponId) {
      params.discounts = [{ coupon: couponId }];
    }

    const subscription = await stripe.subscriptions.create(params);

    const latest = subscription.latest_invoice as Stripe.Invoice | null;
    const clientSecret =
      (latest && (latest as any).payment_intent && (latest as any).payment_intent.client_secret) || null;

    // If trial produced no PaymentIntent, collect a card via SetupIntent so usage can still bill.
    let setupClientSecret: string | null = null;
    if (!clientSecret) {
      const trialDaysNum = typeof trialDays === "number" ? trialDays : Number(trialDays || 0);
      if (trialDaysNum > 0) {
        const si = await stripe.setupIntents.create({
          customer: customerId,
          payment_method_types: ["card"],
          usage: "off_session",
          metadata: {
            userId: userIdMeta,
            subscriptionId: subscription.id,
            email: effectiveEmail,
          },
        });
        setupClientSecret = si.client_secret || null;
      }
    }

    return res.status(200).json({
      clientSecret,
      setupClientSecret,
      discount: discountLabel,
      discountAmount,
      promoCode: enteredCode || null,
      totalBeforeDiscount,
      totalAfterDiscount,
      subscriptionId: subscription.id,
    });
  } catch (err: any) {
    console.error("Stripe subscription error:", err);
    return res.status(500).json({ error: err?.message || "Subscription creation failed" });
  }
}

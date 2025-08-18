// /pages/api/create-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

// UI helper numbers only (kept from your version)
const BASE_PRICE = 199.99;
const AI_ADDON_PRICE = 50;

// Use env price IDs so they’re always correct for your current Stripe account
const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY; // required
const AI_ADDON_PRICE_ID = process.env.STRIPE_PRICE_ID_AI_ADDON || ""; // optional

async function ensureStripeCustomer(
  userDoc: any,
  email: string,
): Promise<string> {
  let cid: string | null =
    userDoc?.stripeCustomerId || userDoc?.stripeCustomerID || null;

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
      // else fall through to create new
    }
  }

  const created = await stripe.customers.create({
    email,
    metadata: { userId: String(userDoc?._id || "") },
  });

  if (userDoc) {
    userDoc.stripeCustomerId = created.id;
    if (typeof userDoc.set === "function")
      userDoc.set("stripeCustomerId", created.id);
    await userDoc.save();
  }
  return created.id;
}

async function resolveActivePromotionCodeId(
  input?: string | null,
): Promise<string | null> {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  // Exact, active first
  const exact = await stripe.promotionCodes.list({
    code: raw,
    active: true,
    limit: 1,
  });
  if (exact.data[0]) return exact.data[0].id;

  // Case-insensitive fallback among first 100 active
  const list = await stripe.promotionCodes.list({ active: true, limit: 100 });
  const pc = list.data.find((p) => p.code.toLowerCase() === raw.toLowerCase());
  return pc ? pc.id : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method not allowed");

  const {
    email: bodyEmail,
    aiUpgrade,
    affiliateEmail,
    promoCode,
  } = (req.body || {}) as {
    email?: string;
    aiUpgrade?: boolean;
    affiliateEmail?: string;
    promoCode?: string;
  };

  try {
    await dbConnect();

    // Prefer logged-in user; fall back to provided email to allow testing
    const session = await getServerSession(req, res, authOptions);
    const effectiveEmail = (session?.user?.email || bodyEmail || "")
      .toLowerCase()
      .trim();
    if (!effectiveEmail)
      return res.status(400).json({ error: "Missing email." });

    const userDoc = await User.findOne({ email: effectiveEmail });

    // Ensure a valid customer in THIS Stripe account
    const customerId = await ensureStripeCustomer(userDoc, effectiveEmail);

    // UI totals (unchanged)
    const totalBeforeDiscount = BASE_PRICE + (aiUpgrade ? AI_ADDON_PRICE : 0);

    // Enforce your rule:
    // - If a code was provided AND it is NOT active/valid -> block with error
    // - If no code -> allow
    let promotionCodeId: string | undefined = undefined;
    if (promoCode && promoCode.trim()) {
      const resolved = await resolveActivePromotionCodeId(promoCode);
      if (!resolved)
        return res.status(400).json({ error: "Not a valid code." });
      promotionCodeId = resolved;
    }

    // Compute display discount (for your UI)
    let discountAmount = 0;
    let discountLabel: string | null = null;
    if (promotionCodeId) {
      const pc = await stripe.promotionCodes.retrieve(promotionCodeId);
      const coupon =
        typeof pc.coupon === "string"
          ? await stripe.coupons.retrieve(pc.coupon)
          : pc.coupon;
      if ((coupon as any).amount_off) {
        discountAmount = (coupon as any).amount_off / 100;
        discountLabel = `$${discountAmount.toFixed(2)} off`;
      } else if ((coupon as any).percent_off) {
        discountAmount =
          totalBeforeDiscount * ((coupon as any).percent_off / 100);
        discountLabel = `${(coupon as any).percent_off}% off`;
      }
    }
    const totalAfterDiscount = Math.max(
      totalBeforeDiscount - discountAmount,
      0,
    );

    if (!BASE_PRICE_ID) {
      return res
        .status(500)
        .json({ error: "Missing STRIPE_PRICE_ID_MONTHLY env." });
    }

    const items: Stripe.SubscriptionCreateParams.Item[] = [
      { price: BASE_PRICE_ID, quantity: 1 },
    ];
    if (aiUpgrade && AI_ADDON_PRICE_ID)
      items.push({ price: AI_ADDON_PRICE_ID, quantity: 1 });

    const referralCodeUsed = promoCode
      ? String(promoCode).toUpperCase()
      : "none";
    const userIdMeta = userDoc?._id?.toString() || "";

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items,
      promotion_code: promotionCodeId,
      payment_behavior: "default_incomplete", // works with Payment Element
      metadata: {
        userId: userIdMeta,
        referralCodeUsed, // your webhooks read this
        affiliateEmail: affiliateEmail || "",
        aiUpgrade: aiUpgrade ? "true" : "false",
        appliedPromoCode: promoCode || "",
      },
      expand: ["latest_invoice.payment_intent"],
    });

    const latest = subscription.latest_invoice as Stripe.Invoice | null;
    const clientSecret =
      (latest &&
        (latest as any).payment_intent &&
        (latest as any).payment_intent.client_secret) ||
      null;

    return res.status(200).json({
      clientSecret,
      discount: discountLabel,
      discountAmount,
      promoCode: promoCode || null,
      totalBeforeDiscount,
      totalAfterDiscount,
      subscriptionId: subscription.id,
    });
  } catch (err: any) {
    console.error("Stripe subscription error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Subscription creation failed" });
  }
}

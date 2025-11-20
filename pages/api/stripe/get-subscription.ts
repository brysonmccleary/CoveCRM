// /pages/api/stripe/get-subscription.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

const BASE_PRICE_ID = process.env.STRIPE_PRICE_ID_MONTHLY || "";
// AI price can be either env – use whatever you actually use in Stripe
const AI_PRICE_ID =
  process.env.STRIPE_PRICE_ID_AI_MONTHLY ||
  process.env.STRIPE_PRICE_ID_AI_ADDON ||
  "";

// --- helpers copied from your create-subscription logic ----

async function resolvePromotionCodeId(codeText: string): Promise<string | null> {
  const trimmed = codeText.trim();
  if (!trimmed) return null;

  // exact match
  const exact = await stripe.promotionCodes.list({
    code: trimmed,
    active: true,
    limit: 1,
  });
  if (exact.data?.[0]?.id) return exact.data[0].id;

  // fallback: scan a page, match case-insensitive
  const page = await stripe.promotionCodes.list({ active: true, limit: 100 });
  const lc = trimmed.toLowerCase();
  const found = page.data.find((p) => (p.code || "").toLowerCase() === lc);
  return found?.id || null;
}

async function resolveCouponId(codeText: string): Promise<string | null> {
  const trimmed = codeText.trim();
  if (!trimmed) return null;

  // try as coupon id
  try {
    const byId = await stripe.coupons.retrieve(trimmed);
    if ((byId as any)?.id) return byId.id;
  } catch {
    // ignore
  }

  // fallback: search by name
  const page = await stripe.coupons.list({ limit: 100 });
  const lc = trimmed.toLowerCase();
  const found = page.data.find((c) => (c.name || "").toLowerCase() === lc);
  return found?.id || null;
}

// ----------------------------------------------------------

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();

  const user = await User.findOne({ email: session.user.email });
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  // Support both legacy stripeCustomerID and new stripeCustomerId
  const stripeCustomerId =
    (user as any).stripeCustomerId ||
    (user as any).stripeCustomerID ||
    null;

  console.log("[get-subscription] user", {
    email: user.email,
    stripeCustomerId,
    hasStripeCustomerIdField: !!(user as any).stripeCustomerId,
    hasLegacyStripeCustomerIDField: !!(user as any).stripeCustomerID,
    BASE_PRICE_ID,
    AI_PRICE_ID,
  });

  if (!stripeCustomerId || !BASE_PRICE_ID) {
    console.log("[get-subscription] early-exit: missing customer or base price", {
      stripeCustomerId,
      BASE_PRICE_ID,
    });
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }

  try {
    // Resolve the base CRM price → get its product id so we can match legacy prices.
    const basePrice = (await stripe.prices.retrieve(
      BASE_PRICE_ID
    )) as Stripe.Price;
    const baseProductId =
      (basePrice.product as string | null | undefined) || null;

    console.log("[get-subscription] base price resolved", {
      BASE_PRICE_ID,
      baseProductId,
      baseUnitAmount: basePrice.unit_amount,
    });

    // Fetch all subs, only expanding prices.
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      expand: ["data.items.data.price"],
    });

    console.log("[get-subscription] subscriptions fetched", {
      count: subs.data.length,
      ids: subs.data.map((s) => ({ id: s.id, status: s.status })),
    });

    let crmAmountCents: number | null = null;
    let hasAI = false;

    for (const sub of subs.data as Stripe.Subscription[]) {
      const isActiveLike =
        sub.status === "active" || sub.status === "trialing";
      if (!isActiveLike) continue;

      const items = sub.items.data as Stripe.SubscriptionItem[];

      const itemSummary = items.map((it) => {
        const price = it.price as Stripe.Price | null | undefined;
        return {
          priceId: price?.id,
          productId: price?.product || null,
          unitAmount: price?.unit_amount,
        };
      });

      console.log("[get-subscription] inspecting subscription", {
        subscriptionId: sub.id,
        status: sub.status,
        itemSummary,
        metadata: sub.metadata,
      });

      // Detect AI add-on across any subscription
      if (AI_PRICE_ID) {
        const hasAiItem = items.some(
          (it) => it.price && it.price.id === AI_PRICE_ID
        );
        if (hasAiItem) {
          hasAI = true;
        }
      }

      // Find CRM item on this sub by price ID or product match
      const crmItem = items.find((it) => {
        const price = it.price as Stripe.Price | null | undefined;
        if (!price) return false;
        const productId = price.product as string | null | undefined;
        return (
          price.id === BASE_PRICE_ID ||
          (!!baseProductId && !!productId && productId === baseProductId)
        );
      });

      if (!crmItem) {
        console.log("[get-subscription] no CRM item on this subscription", {
          subscriptionId: sub.id,
        });
        continue;
      }

      // If we've already set a CRM amount, don't overwrite it (but still track AI above).
      if (crmAmountCents !== null) {
        console.log(
          "[get-subscription] CRM amount already set, skipping price update",
          {
            subscriptionId: sub.id,
            existingCrmAmountCents: crmAmountCents,
          }
        );
        continue;
      }

      // Base CRM amount in cents (before discounts)
      const baseCents = crmItem.price?.unit_amount ?? 0;

      // Determine which promo code was used, preferring subscription metadata
      const meta = sub.metadata || {};
      let appliedCode =
        (meta.appliedPromoCode as string) ||
        (meta.referralCodeUsed as string) ||
        (meta.promoCode as string) ||
        (user as any).usedCode ||
        (user as any).referredByCode ||
        "";

      appliedCode = (appliedCode || "").trim();

      console.log("[get-subscription] CRM item found", {
        subscriptionId: sub.id,
        crmPriceId: crmItem.price?.id,
        crmProductId: crmItem.price?.product || null,
        crmBaseUnitAmount: crmItem.price?.unit_amount,
        appliedCode,
      });

      let effectiveCents = baseCents;

      if (appliedCode) {
        try {
          let coupon: Stripe.Coupon | null = null;

          const promoId = await resolvePromotionCodeId(appliedCode);
          if (promoId) {
            const pc = await stripe.promotionCodes.retrieve(promoId);
            const rawCoupon = pc.coupon as Stripe.Coupon | string;
            if (typeof rawCoupon !== "string") {
              coupon = rawCoupon as Stripe.Coupon;
            } else {
              const fetched = (await stripe.coupons.retrieve(
                rawCoupon
              )) as Stripe.Coupon;
              coupon = fetched;
            }
          } else {
            const couponId = await resolveCouponId(appliedCode);
            if (couponId) {
              const fetched = (await stripe.coupons.retrieve(
                couponId
              )) as Stripe.Coupon;
              coupon = fetched;
            }
          }

          console.log("[get-subscription] resolved coupon from code", {
            subscriptionId: sub.id,
            appliedCode,
            couponSummary: coupon
              ? {
                  id: coupon.id,
                  amount_off: coupon.amount_off,
                  percent_off: coupon.percent_off,
                }
              : null,
          });

          if (coupon) {
            if (coupon.amount_off) {
              effectiveCents = Math.max(baseCents - coupon.amount_off, 0);
            } else if (coupon.percent_off) {
              const pct = coupon.percent_off / 100;
              const discountCents = Math.round(baseCents * pct);
              effectiveCents = Math.max(baseCents - discountCents, 0);
            }
          }
        } catch (e: any) {
          console.error(
            "[get-subscription] error resolving coupon from promo code",
            appliedCode,
            e?.message || e
          );
          // If coupon resolution fails, we just leave effectiveCents = baseCents
        }
      } else {
        console.log(
          "[get-subscription] no appliedCode for CRM subscription; using base price",
          { subscriptionId: sub.id }
        );
      }

      crmAmountCents = effectiveCents;

      console.log("[get-subscription] computed CRM amount", {
        subscriptionId: sub.id,
        baseCents,
        crmAmountCents,
      });
    }

    if (crmAmountCents === null) {
      console.log("[get-subscription] no CRM subscription found at all", {
        stripeCustomerId,
      });
      return res.status(200).json({
        amount: null,
        hasAIUpgrade: hasAI || !!(user as any).hasAI,
      });
    }

    const amountNumber = Number((crmAmountCents / 100).toFixed(2));

    console.log("[get-subscription] final result", {
      amountNumber,
      hasAIUpgrade: hasAI || !!(user as any).hasAI,
    });

    return res.status(200).json({
      amount: amountNumber,
      hasAIUpgrade: hasAI || !!(user as any).hasAI,
    });
  } catch (err: any) {
    console.error("get-subscription error:", err?.message || err);
    return res.status(200).json({
      amount: null,
      hasAIUpgrade: !!(user as any).hasAI,
    });
  }
}

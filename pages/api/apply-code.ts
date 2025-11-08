import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";

/** UI base price for display (server-side subscription still applies the real discount in Stripe) */
const UI_BASE_PRICE =
  Number(process.env.NEXT_PUBLIC_BASE_PRICE || process.env.BASE_PRICE_UI || 199.99);

const upper = (s?: string | null) => (s || "").trim().toUpperCase();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { code } = (req.body || {}) as { code?: string };
    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ error: "Code is required." });
    }
    const raw = code.trim();
    const RAW_UP = upper(raw);

    // 1) Try Promotion Code (exact + active)
    let pc: Stripe.PromotionCode | undefined = (
      await stripe.promotionCodes.list({ code: raw, active: true, limit: 1 })
    ).data?.[0];

    // 1b) Case-insensitive scan of active promotion codes
    if (!pc) {
      const list = await stripe.promotionCodes.list({ active: true, limit: 100 });
      pc = list.data.find((p) => (p.code || "").toLowerCase() === raw.toLowerCase());
    }

    // Helper to compute discounted price from a Stripe coupon entity
    const computePriceFromCoupon = (coupon: Stripe.Coupon) => {
      let discountAmount = 0;
      if ((coupon as any).amount_off) discountAmount = (coupon as any).amount_off / 100;
      else if ((coupon as any).percent_off) discountAmount = UI_BASE_PRICE * ((coupon as any).percent_off / 100);
      const price = Math.max(UI_BASE_PRICE - discountAmount, 0);
      let discountLabel: string | null = null;
      if ((coupon as any).amount_off) discountLabel = `$${((coupon as any).amount_off / 100).toFixed(2)} off`;
      else if ((coupon as any).percent_off) discountLabel = `${(coupon as any).percent_off}% off`;
      return { price, discountLabel };
    };

    let responsePayload: any = { success: true, source: "stripe" };

    if (pc) {
      const coupon = typeof pc.coupon === "string" ? await stripe.coupons.retrieve(pc.coupon) : pc.coupon;
      const { price, discountLabel } = computePriceFromCoupon(coupon as Stripe.Coupon);
      responsePayload = {
        ...responsePayload,
        code: pc.code,
        promotionCodeId: pc.id,
        couponId: typeof pc.coupon === "string" ? pc.coupon : (pc.coupon as Stripe.Coupon).id,
        discount: discountLabel,
        price,
      };
    } else {
      // 2) Fallback to Coupon lookup (by id==code or name==code, case-insensitive)
      // 2a) Try coupon id == code
      let coupon: Stripe.Coupon | null = null;
      try {
        const byId = await stripe.coupons.retrieve(raw);
        if ((byId as any)?.id) coupon = byId;
      } catch {
        /* ignore */
      }

      // 2b) Case-insensitive by name
      if (!coupon) {
        const page = await stripe.coupons.list({ limit: 100 });
        const lc = raw.toLowerCase();
        coupon = page.data.find((c) => (c.name || "").toLowerCase() === lc) || null;
      }

      if (!coupon) return res.status(404).json({ error: "Invalid or expired promo code." });

      const { price, discountLabel } = computePriceFromCoupon(coupon);
      responsePayload = {
        ...responsePayload,
        code: raw,
        promotionCodeId: null,
        couponId: coupon.id,
        discount: discountLabel,
        price,
      };
    }

    // 3) Optional: Affiliate owner email (if you store a mapping)
    try {
      await dbConnect();
      const aff = await Affiliate.findOne({
        $or: [{ promoCode: RAW_UP }, { promoCode: new RegExp(`^${RAW_UP}$`, "i") }],
      })
        .select({ email: 1, ownerEmail: 1, userEmail: 1 })
        .lean();

      if (aff) {
        responsePayload.ownerEmail =
          (aff as any).ownerEmail || (aff as any).email || (aff as any).userEmail || "";
      } else {
        responsePayload.ownerEmail = "";
      }
    } catch {
      responsePayload.ownerEmail = "";
    }

    return res.status(200).json(responsePayload);
  } catch (err: any) {
    console.error("apply-code error:", err);
    return res.status(500).json({ error: err?.message || "Promo code check failed." });
  }
}

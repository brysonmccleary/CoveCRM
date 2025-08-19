import type { NextApiRequest, NextApiResponse } from "next";
import { stripe } from "@/lib/stripe";
import type Stripe from "stripe";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { code } = (req.body || {}) as { code?: string };
    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ error: "Code is required." });
    }
    const raw = code.trim();

    // Try exact, active first
    let pc: Stripe.PromotionCode | undefined = (
      await stripe.promotionCodes.list({ code: raw, active: true, limit: 1 })
    ).data[0];

    // Case-insensitive fallback among a window of active codes
    if (!pc) {
      const list = await stripe.promotionCodes.list({ active: true, limit: 100 });
      pc = list.data.find((p) => p.code.toLowerCase() === raw.toLowerCase());
    }

    if (!pc) return res.status(404).json({ error: "Invalid or expired promo code." });

    const coupon = typeof pc.coupon === "string" ? await stripe.coupons.retrieve(pc.coupon) : pc.coupon;

    let discount: string | null = null;
    if ((coupon as any).amount_off) discount = `$${((coupon as any).amount_off / 100).toFixed(2)} off`;
    else if ((coupon as any).percent_off) discount = `${(coupon as any).percent_off}% off`;

    return res.status(200).json({
      success: true,
      code: pc.code,
      promotionCodeId: pc.id,
      couponId: typeof pc.coupon === "string" ? pc.coupon : pc.coupon.id,
      discount,
      source: "stripe",
    });
  } catch (err: any) {
    console.error("apply-code error:", err);
    return res.status(500).json({ error: err?.message || "Promo code check failed." });
  }
}

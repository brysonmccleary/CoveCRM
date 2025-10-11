import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

const AUTH = process.env.INTERNAL_API_TOKEN;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "") || (req.query.token as string);
  if (!AUTH || token !== AUTH) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();

  let starting_after: string | undefined;
  let upserts = 0;

  do {
    const page = await stripe.promotionCodes.list({ active: true, limit: 100, starting_after });
    for (const promo of page.data) {
      const code = (promo.code || "").trim().toUpperCase();
      const couponId = typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;
      await Affiliate.findOneAndUpdate(
        { promoCode: code },
        {
          $set: {
            promoCode: code,
            promotionCodeId: promo.id,
            couponId,
            approved: !!promo.active,
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true },
      );
      upserts++;
    }
    starting_after = page.has_more ? page.data[page.data.length - 1].id : undefined;
  } while (starting_after);

  return res.status(200).json({ ok: true, upserts });
}

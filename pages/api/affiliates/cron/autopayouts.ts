import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import { stripe } from "@/lib/stripe";

const envBool = (name: string, def = false) => {
  const v = process.env[name];
  if (v == null) return def;
  return v === "1" || v.toLowerCase() === "true";
};
const toCents = (usd: number) => Math.round(Number(usd || 0) * 100);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow GET or POST for Vercel Cron
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).end("Method Not Allowed");
  }

  const secret = process.env.CRON_SECRET || "";
  const authz = req.headers.authorization || "";
  const token = (req.query.token as string) || "";

  // Accept Authorization header OR ?token= for Vercel Cron
  const ok =
    (!!secret && authz === `Bearer ${secret}`) ||
    (!!secret && token === secret);

  if (!ok) return res.status(401).json({ error: "Unauthorized" });

  const minUSD = Number(process.env.AFFILIATE_MIN_PAYOUT_USD || 50);
  const autopay = envBool("AFFILIATE_AUTOPAY", false);

  try {
    await dbConnect();

    const affiliates = await Affiliate.find({
      payoutDue: { $gte: minUSD },
    }).lean(false);

    const results: any[] = [];

    for (const affiliate of affiliates) {
      const amountUSD = Math.floor(Number(affiliate.payoutDue || 0) * 100) / 100;
      const idempotencyKey = `sweep:${affiliate._id}:${Math.round(amountUSD * 100)}`;

      const exists = await AffiliatePayout.findOne({ idempotencyKey }).lean();
      if (exists) {
        results.push({ promoCode: affiliate.promoCode, skipped: "already processed" });
        continue;
      }

      const canAutopay =
        autopay &&
        affiliate.stripeConnectId &&
        (affiliate.connectedAccountStatus === "verified" || affiliate.onboardingCompleted === true);

      if (!canAutopay) {
        await AffiliatePayout.create({
          affiliateId: String(affiliate._id),
          affiliateEmail: affiliate.email,
          amount: amountUSD,
          currency: "usd",
          status: "queued",
          idempotencyKey,
        });
        results.push({ promoCode: affiliate.promoCode, queued: amountUSD });
        continue;
      }

      try {
        const transfer = await stripe.transfers.create({
          amount: toCents(amountUSD),
          currency: "usd",
          destination: affiliate.stripeConnectId!,
          description: `Affiliate payout sweep (${affiliate.promoCode})`,
        });

        await AffiliatePayout.create({
          affiliateId: String(affiliate._id),
          affiliateEmail: affiliate.email,
          amount: amountUSD,
          currency: "usd",
          stripeTransferId: transfer.id,
          status: "sent",
          idempotencyKey,
        });

        affiliate.payoutDue = Math.max(0, Number(affiliate.payoutDue || 0) - amountUSD);
        affiliate.totalPayoutsSent = Number(affiliate.totalPayoutsSent || 0) + amountUSD;
        affiliate.lastPayoutDate = new Date();
        await affiliate.save();

        results.push({ promoCode: affiliate.promoCode, sent: amountUSD, transferId: transfer.id });
      } catch (e: any) {
        await AffiliatePayout.create({
          affiliateId: String(affiliate._id),
          affiliateEmail: affiliate.email,
          amount: amountUSD,
          currency: "usd",
          status: "failed",
          idempotencyKey,
        });
        results.push({ promoCode: affiliate.promoCode, failed: e?.message || "transfer failed" });
      }
    }

    return res.status(200).json({ ok: true, results });
  } catch (e: any) {
    console.error("autopayouts error:", e?.message || e);
    return res.status(500).json({ error: "Autopayout sweep failed" });
  }
}

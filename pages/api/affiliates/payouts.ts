// /pages/api/affiliates/payouts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]"; // ✅ correct relative path
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import { sendAffiliatePayoutEmail } from "@/lib/email";
import Stripe from "stripe";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2024-04-10",
});

const MIN_PAYOUT = Number(process.env.AFFILIATE_MIN_PAYOUT || 50);

// Default to current month for the reporting window (used in emails/logging/idempotency)
function currentPeriod() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setMilliseconds(-1);
  return { periodStart: start, periodEnd: end };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Admin-only
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email || (session.user as any).role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  await mongooseConnect();

  const { periodStart: defaultStart, periodEnd: defaultEnd } = currentPeriod();
  const periodStart = req.body?.periodStart ? new Date(req.body.periodStart) : defaultStart;
  const periodEnd = req.body?.periodEnd ? new Date(req.body.periodEnd) : defaultEnd;

  const affiliates = await Affiliate.find({
    payoutDue: { $gte: MIN_PAYOUT },
    stripeConnectId: { $exists: true, $ne: "" },
    onboardingCompleted: true,
    connectedAccountStatus: "verified",
  });

  const results: { email: string; amount: number; success: boolean; transferId?: string; error?: string }[] = [];

  for (const a of affiliates) {
    const amount = Number(a.payoutDue || 0);
    if (amount < MIN_PAYOUT) continue;

    // Idempotency: affiliate + period + amount
    const idemKey = crypto
      .createHash("sha256")
      .update(`${a._id.toString()}|${periodStart.toISOString()}|${periodEnd.toISOString()}|${amount.toFixed(2)}`)
      .digest("hex");

    try {
      // If we already logged this exact payout, skip
      const exists = await AffiliatePayout.findOne({ idempotencyKey: idemKey });
      if (exists) {
        results.push({ email: a.email, amount, success: true, transferId: exists.stripeTransferId });
        continue;
      }

      // Create a Connect transfer
      const transfer = await stripe.transfers.create(
        {
          amount: Math.round(amount * 100),
          currency: "usd",
          destination: a.stripeConnectId!,
          description: `CoveCRM Affiliate Payout — ${periodStart.toLocaleDateString()}–${periodEnd.toLocaleDateString()}`,
        },
        { idempotencyKey: idemKey }
      );

      // Log payout
      await AffiliatePayout.create({
        affiliateId: a._id.toString(),
        affiliateEmail: a.email,
        amount,
        currency: "usd",
        periodStart,
        periodEnd,
        stripeTransferId: transfer.id,
        status: "sent", // optimistic; webhook will confirm/flip if reversed
        idempotencyKey: idemKey,
      });

      // Update affiliate running totals
      a.totalPayoutsSent = (a.totalPayoutsSent || 0) + amount;
      a.payoutDue = Math.max(0, (a.payoutDue || 0) - amount);
      a.lastPayoutDate = new Date();
      await a.save();

      // Email the affiliate
      const base =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.BASE_URL ||
        process.env.NEXTAUTH_URL ||
        "";
      await sendAffiliatePayoutEmail({
        to: a.email,
        amount,
        currency: "USD",
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        balanceAfter: a.payoutDue || 0,
        dashboardUrl: `${base}/affiliates/earnings`,
      });

      results.push({ email: a.email, amount, success: true, transferId: transfer.id });
    } catch (err: any) {
      console.error(`❌ Failed payout to ${a.email}:`, err);
      results.push({ email: a.email, amount, success: false, error: err?.message || String(err) });
    }
  }

  return res.status(200).json({ success: true, periodStart, periodEnd, results });
}

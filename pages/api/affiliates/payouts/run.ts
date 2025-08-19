import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import { sendAffiliatePayoutEmail } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import crypto from "crypto";

// Minimum payout threshold (USD)
const MIN_PAYOUT = Number(process.env.AFFILIATE_MIN_PAYOUT || 5);

// Period window helper: default to “current month”
function getCurrentPeriod() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setMilliseconds(-1);
  return { periodStart: start, periodEnd: end };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  await mongooseConnect();

  const { periodStart: defaultStart, periodEnd: defaultEnd } =
    getCurrentPeriod();
  const { periodStart, periodEnd } = {
    periodStart: req.body?.periodStart
      ? new Date(req.body.periodStart)
      : defaultStart,
    periodEnd: req.body?.periodEnd ? new Date(req.body.periodEnd) : defaultEnd,
  };

  // Find affiliates ready for payout
  const affiliates = await Affiliate.find({
    payoutDue: { $gte: MIN_PAYOUT },
    stripeConnectId: { $exists: true, $ne: "" },
    onboardingCompleted: true,
    connectedAccountStatus: "verified",
  });

  const results: {
    affiliateId: string;
    email: string;
    amount: number;
    success: boolean;
    transferId?: string;
    error?: string;
  }[] = [];

  for (const a of affiliates) {
    const amount = Number(a.payoutDue || 0);
    if (amount < MIN_PAYOUT) continue;

    // Idempotency (affiliate + period + amount)
    const idemKey = crypto
      .createHash("sha256")
      .update(
        `${a._id.toString()}|${periodStart.toISOString()}|${periodEnd.toISOString()}|${amount.toFixed(2)}`,
      )
      .digest("hex");

    try {
      // Have we already created a payout with this idem key?
      const existing = await AffiliatePayout.findOne({
        idempotencyKey: idemKey,
      });
      if (existing) {
        results.push({
          affiliateId: a._id.toString(),
          email: a.email,
          amount,
          success: true,
          transferId: existing.stripeTransferId || undefined,
        });
        continue;
      }

      // Create Stripe Connect transfer
      const transfer = await stripe.transfers.create(
        {
          amount: Math.round(amount * 100),
          currency: "usd",
          destination: a.stripeConnectId!,
          description: `CoveCRM Affiliate Payout — ${periodStart.toLocaleDateString()}–${periodEnd.toLocaleDateString()}`,
        },
        { idempotencyKey: idemKey },
      );

      // Record payout
      await AffiliatePayout.create({
        affiliateId: a._id.toString(),
        affiliateEmail: a.email,
        amount,
        currency: "usd",
        periodStart,
        periodEnd,
        stripeTransferId: transfer.id,
        status: "sent",
        idempotencyKey: idemKey,
      });

      // Update affiliate counters
      a.totalPayoutsSent = (a.totalPayoutsSent || 0) + amount;
      a.payoutDue = Math.max(0, (a.payoutDue || 0) - amount);
      a.lastPayoutDate = new Date();
      a.payoutHistory.push({
        amount,
        userEmail: a.email,
        date: new Date(),
      });
      await a.save();

      // Email the affiliate
      await sendAffiliatePayoutEmail({
        to: a.email,
        amount,
        currency: "USD",
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        balanceAfter: a.payoutDue || 0,
        dashboardUrl: `${
          process.env.NEXT_PUBLIC_BASE_URL ||
          process.env.BASE_URL ||
          process.env.NEXTAUTH_URL ||
          ""
        }/affiliates/earnings`,
      });

      results.push({
        affiliateId: a._id.toString(),
        email: a.email,
        amount,
        success: true,
        transferId: transfer.id,
      });
    } catch (err: any) {
      results.push({
        affiliateId: a._id.toString(),
        email: a.email,
        amount,
        success: false,
        error: err?.message || String(err),
      });
    }
  }

  return res
    .status(200)
    .json({ ok: true, periodStart, periodEnd, count: results.length, results });
}

// /pages/api/cron/affiliate-payouts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Stripe from "stripe";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import { sendAffiliatePayoutEmail } from "@/lib/email";
import crypto from "crypto";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-04-10" });

const MIN_PAYOUT = Number(process.env.AFFILIATE_MIN_PAYOUT || 50);

function currentPeriod() {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setMilliseconds(-1);
  return { periodStart: start, periodEnd: end };
}

// Accept both POST with Authorization header OR GET/POST with ?token=
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth: header OR query param token
  const bearer = req.headers.authorization || "";
  const expectedHeader = `Bearer ${process.env.INTERNAL_API_TOKEN}`;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  const okHeader = expectedHeader && bearer === expectedHeader;
  const okQuery = process.env.INTERNAL_API_TOKEN && queryToken === process.env.INTERNAL_API_TOKEN;

  if (!okHeader && !okQuery) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    await dbConnect();

    const { periodStart, periodEnd } = currentPeriod();

    const affiliates = await Affiliate.find({
      payoutDue: { $gte: MIN_PAYOUT },
      stripeConnectId: { $exists: true, $ne: "" },
      onboardingCompleted: true,
      connectedAccountStatus: "verified",
    });

    const base =
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      process.env.NEXTAUTH_URL ||
      "";

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
        const exists = await AffiliatePayout.findOne({ idempotencyKey: idemKey });
        if (exists) {
          results.push({ email: a.email, amount, success: true, transferId: exists.stripeTransferId });
          continue;
        }

        // Create Connect transfer
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
          status: "sent", // webhook will confirm/flip if reversed
          idempotencyKey: idemKey,
        });

        // Update affiliate totals
        a.totalPayoutsSent = (a.totalPayoutsSent || 0) + amount;
        a.payoutDue = Math.max(0, (a.payoutDue || 0) - amount);
        a.lastPayoutDate = new Date();
        await a.save();

        // Email receipt
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
  } catch (err) {
    console.error("Affiliate payout cron error:", err);
    return res.status(500).json({ error: "Server error." });
  }
}

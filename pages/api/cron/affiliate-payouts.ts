// pages/api/cron/affiliate-payouts.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayout from "@/models/AffiliatePayout";
import { sendAffiliatePayoutEmail } from "@/lib/email";
import { stripe } from "@/lib/stripe";
import crypto from "crypto";

const MIN_PAYOUT = Number(process.env.AFFILIATE_MIN_PAYOUT_USD ?? process.env.AFFILIATE_MIN_PAYOUT ?? 50);

function currentPeriod() {
  // Month-to-date window (1st 00:00:00.000 through end of month)
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setMonth(end.getMonth() + 1);
  end.setMilliseconds(-1);
  return { periodStart: start, periodEnd: end };
}

function bool(v: any) {
  const s = String(v ?? "").toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function buildIdemKey(affiliateId: string, periodStart: Date, periodEnd: Date, amountUSD: number) {
  return crypto
    .createHash("sha256")
    .update(`${affiliateId}|${periodStart.toISOString()}|${periodEnd.toISOString()}|${amountUSD.toFixed(2)}`)
    .digest("hex");
}

// Accept POST with Authorization header OR GET/POST with ?token=
// Optional: ?dryRun=1 to simulate (no Stripe transfer, no DB mutations to Affiliate/Email/Payout rows)
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Auth: header OR query param token
  const bearer = req.headers.authorization || "";
  const expectedHeader = `Bearer ${process.env.INTERNAL_API_TOKEN || ""}`;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;

  const okHeader = Boolean(process.env.INTERNAL_API_TOKEN) && bearer === expectedHeader;
  const okQuery  = Boolean(process.env.INTERNAL_API_TOKEN) && queryToken === process.env.INTERNAL_API_TOKEN;

  if (!okHeader && !okQuery) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const DRY_RUN = bool(req.query.dryRun);

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

    const results: Array<{
      affiliateId: string;
      email: string;
      amount: number;
      success: boolean;
      transferId?: string;
      idempotencyKey?: string;
      dryRun?: boolean;
      error?: string;
    }> = [];

    for (const a of affiliates) {
      // Normalize to two decimals (floor to avoid paying extra due to float noise)
      const amount = Math.floor(Number(a.payoutDue || 0) * 100) / 100;

      if (!(amount > 0) || amount < MIN_PAYOUT) continue;
      // Safety clamp (shouldn’t be < 0, but guard anyway)
      if (amount <= 0) {
        a.payoutDue = Math.max(0, Number(a.payoutDue || 0));
        await a.save();
        continue;
      }

      const idemKey = buildIdemKey(String(a._id), periodStart, periodEnd, amount);

      // If we already have a payout row for this period+amount, skip (idempotent)
      const exists = await AffiliatePayout.findOne({ idempotencyKey: idemKey });
      if (exists) {
        results.push({
          affiliateId: String(a._id),
          email: a.email,
          amount,
          success: true,
          transferId: exists.stripeTransferId,
          idempotencyKey: idemKey,
        });
        continue;
      }

      // Dry run path: simulate only, no writes and no transfer
      if (DRY_RUN) {
        results.push({
          affiliateId: String(a._id),
          email: a.email,
          amount,
          success: true,
          dryRun: true,
          idempotencyKey: idemKey,
        });
        continue;
      }

      try {
        // Create Stripe Connect transfer (also idempotent at Stripe)
        const transfer = await stripe.transfers.create(
          {
            amount: Math.round(amount * 100),
            currency: "usd",
            destination: a.stripeConnectId!,
            description: `Affiliate payout — ${periodStart.toLocaleDateString()}–${periodEnd.toLocaleDateString()}`,
          },
          { idempotencyKey: idemKey },
        );

        // Log payout row
        await AffiliatePayout.create({
          affiliateId: a._id.toString(),
          affiliateEmail: a.email,
          amount,
          currency: "usd",
          periodStart,
          periodEnd,
          stripeTransferId: transfer.id,
          status: "sent", // transfer.created webhook will confirm as well
          idempotencyKey: idemKey,
        });

        // Update affiliate balances
        a.totalPayoutsSent = (a.totalPayoutsSent || 0) + amount;
        a.payoutDue = Math.max(0, (a.payoutDue || 0) - amount);
        a.lastPayoutDate = new Date();
        await a.save();

        // Email receipt (non-fatal on error)
        try {
          await sendAffiliatePayoutEmail({
            to: a.email,
            amount,
            currency: "USD",
            periodStart: periodStart.toISOString(),
            periodEnd: periodEnd.toISOString(),
            balanceAfter: a.payoutDue || 0,
            dashboardUrl: base ? `${base}/affiliates/earnings` : undefined,
          });
        } catch (e: any) {
          console.warn("sendAffiliatePayoutEmail failed:", e?.message || e);
        }

        results.push({
          affiliateId: String(a._id),
          email: a.email,
          amount,
          success: true,
          transferId: transfer.id,
          idempotencyKey: idemKey,
        });
      } catch (err: any) {
        console.error(`❌ Failed payout to ${a.email}:`, err);

        // Optional: record failed attempt for audit trail
        await AffiliatePayout.create({
          affiliateId: a._id.toString(),
          affiliateEmail: a.email,
          amount,
          currency: "usd",
          periodStart,
          periodEnd,
          status: "failed",
          idempotencyKey: idemKey,
        });

        results.push({
          affiliateId: String(a._id),
          email: a.email,
          amount,
          success: false,
          idempotencyKey: idemKey,
          error: err?.message || String(err),
        });
      }
    }

    return res.status(200).json({
      success: true,
      dryRun: DRY_RUN,
      periodStart,
      periodEnd,
      minPayoutUSD: MIN_PAYOUT,
      count: results.length,
      results,
    });
  } catch (err: any) {
    console.error("Affiliate payout cron error:", err?.message || err);
    return res.status(500).json({ error: "Server error." });
  }
}

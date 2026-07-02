import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayoutLedger from "@/models/AffiliatePayoutLedger";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
import { AFFILIATE_MONTHLY_CREDIT_CENTS } from "@/lib/affiliate/payoutPolicy";

function envBool(name: string, def = false) {
  const value = process.env[name];
  if (value == null) return def;
  return value === "1" || value.toLowerCase() === "true";
}

function dollarsEnvToCents(name: string) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100);
}

function payableCreditMatch(now: Date, affiliateId?: any) {
  const match: any = {
    status: "held",
    payableAt: { $lte: now },
    $or: [{ reversedAt: null }, { reversedAt: { $exists: false } }],
  };
  if (affiliateId) match.affiliateId = affiliateId;
  return match;
}

async function affiliateCanReceivePayout(affiliate: any) {
  if (
    !affiliate?.stripeConnectId ||
    affiliate.onboardingCompleted !== true ||
    affiliate.approved !== true
  ) {
    return { ok: false, reason: "affiliate_not_ready" };
  }

  const owner = await User.findById(affiliate.userId)
    .select({ subscriptionStatus: 1, billingBlocked: 1 })
    .lean();
  if (!owner) return { ok: false, reason: "affiliate_owner_missing" };
  if (
    (owner as any).subscriptionStatus !== "active" ||
    (owner as any).billingBlocked === true
  ) {
    return { ok: false, reason: "affiliate_owner_inactive" };
  }

  return { ok: true, reason: "ok" };
}

async function claimCreditForPayout(creditId: any, now: Date, claimOwner: string) {
  return AffiliatePayoutLedger.findOneAndUpdate(
    {
      _id: creditId,
      status: "held",
      payableAt: { $lte: now },
      $or: [{ reversedAt: null }, { reversedAt: { $exists: false } }],
    },
    {
      $set: {
        status: "processing",
        processingStartedAt: now,
        claimOwner,
      },
    },
    { new: true },
  );
}

async function processClaimedCredit(entry: any, affiliate: any) {
  assertStripeWritesEnabled();
  const entryId = String(entry._id);
  const amountCents = Number(entry.amountCents || AFFILIATE_MONTHLY_CREDIT_CENTS);
  const idempotencyKey = `payout:${entryId}`;
  const transfer = await stripe.transfers.create(
    {
      amount: amountCents,
      currency: "usd",
      destination: affiliate.stripeConnectId,
      transfer_group: `affiliate-${String(entry.affiliateId)}-${entry.month || entryId}`,
      metadata: {
        affiliateId: String(entry.affiliateId),
        userId: String(entry.userId),
        month: String(entry.month || ""),
        ledgerId: entryId,
        invoiceId: String(entry.stripeInvoiceId || ""),
      },
    },
    { idempotencyKey },
  );

  entry.status = "paid";
  entry.paidAt = new Date();
  entry.stripeTransferId = transfer.id;
  entry.reversalReason = null;
  await entry.save();
}

async function markClaimFailed(entry: any, err: any) {
  entry.status = "failed";
  entry.reversalReason = `stripe_transfer_failed:${err?.message || String(err)}`.slice(0, 500);
  await entry.save();
}

function cronSecretMatches(req: NextApiRequest) {
  const direct = String(req.headers["x-api-secret"] || "").trim();
  const authorization = String(req.headers.authorization || "").trim();
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  const allowed = [process.env.COVECRM_API_SECRET, process.env.CRON_SECRET]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return allowed.length > 0 && allowed.includes(direct || bearer);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!cronSecretMatches(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!envBool("AFFILIATE_PAYOUTS_ENABLED", false)) {
    return res.status(423).json({
      error: "Affiliate payouts disabled",
      enabledBy: "AFFILIATE_PAYOUTS_ENABLED",
    });
  }

  await dbConnect();

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skippedInactive = 0;
  let skippedBelowMinimum = 0;
  let skippedNotReady = 0;
  let claimMisses = 0;

  const now = new Date();
  const claimOwner = `affiliate-payout-worker:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
  const minimumCents = dollarsEnvToCents("AFFILIATE_MIN_PAYOUT_USD");

  const affiliateGroups = await AffiliatePayoutLedger.aggregate([
    { $match: payableCreditMatch(now) },
    {
      $group: {
        _id: "$affiliateId",
        totalCents: { $sum: { $ifNull: ["$amountCents", AFFILIATE_MONTHLY_CREDIT_CENTS] } },
        count: { $sum: 1 },
      },
    },
    { $limit: 500 },
  ]);

  for (const group of affiliateGroups) {
    if (minimumCents > 0 && Number(group.totalCents || 0) < minimumCents) {
      skippedBelowMinimum += Number(group.count || 0);
      continue;
    }

    const affiliate = await Affiliate.findById(group._id);
    const gate = await affiliateCanReceivePayout(affiliate);
    if (!gate.ok) {
      if (gate.reason === "affiliate_owner_inactive" || gate.reason === "affiliate_owner_missing") {
        skippedInactive += Number(group.count || 0);
      } else {
        skippedNotReady += Number(group.count || 0);
      }
      continue;
    }

    const credits = await AffiliatePayoutLedger.find(payableCreditMatch(now, group._id))
      .sort({ payableAt: 1, createdAt: 1 })
      .limit(500);

    for (const credit of credits) {
      const claimed = await claimCreditForPayout((credit as any)._id, now, claimOwner);
      if (!claimed) {
        claimMisses += 1;
        continue;
      }

      processed += 1;
      try {
        await processClaimedCredit(claimed, affiliate);
        succeeded += 1;
      } catch (err: any) {
        console.error("[process-affiliate-payouts] transfer failed after claim", {
          ledgerId: String((claimed as any)._id),
          affiliateId: String((claimed as any).affiliateId),
          idempotencyKey: `payout:${String((claimed as any)._id)}`,
          error: err?.message || err,
        });
        await markClaimFailed(claimed, err);
        failed += 1;
      }
    }
  }

  return res.status(200).json({
    processed,
    succeeded,
    failed,
    skippedInactive,
    skippedBelowMinimum,
    skippedNotReady,
    claimMisses,
    minimumCents,
  });
}

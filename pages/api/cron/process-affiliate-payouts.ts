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

function monthStart(offsetMonths = 0) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
}

async function processLedgerEntry(entry: any) {
  const affiliate = await Affiliate.findById(entry.affiliateId);
  if (!affiliate?.stripeConnectId || affiliate.onboardingCompleted !== true) {
    return false;
  }

  const user = await User.findById(entry.userId).lean();
  if (!user || (user as any).subscriptionStatus !== "active") {
    return false;
  }

  assertStripeWritesEnabled();
  const transfer = await stripe.transfers.create(
    {
      amount: Number(entry.amountCents || AFFILIATE_MONTHLY_CREDIT_CENTS),
      currency: "usd",
      destination: affiliate.stripeConnectId,
      transfer_group: `affiliate-${String(entry.affiliateId)}-${entry.month}`,
      metadata: {
        affiliateId: String(entry.affiliateId),
        userId: String(entry.userId),
        month: String(entry.month),
      },
    },
    { idempotencyKey: String(entry.idempotencyKey) },
  );

  entry.status = "paid";
  entry.paidAt = new Date();
  entry.stripeTransferId = transfer.id;
  await entry.save();
  return true;
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
  const annualDripsCreated = 0;

  const entries = await AffiliatePayoutLedger.find({
    status: "pending",
    createdAt: { $gte: monthStart(-1), $lt: monthStart(1) },
  }).limit(500);

  for (const entry of entries) {
    processed += 1;
    try {
      const paid = await processLedgerEntry(entry);
      if (paid) succeeded += 1;
      else failed += 1;
    } catch (err: any) {
      console.error("[process-affiliate-payouts] transfer failed", {
        ledgerId: String((entry as any)._id),
        error: err?.message || err,
      });
      failed += 1;
    }
  }

  return res.status(200).json({ processed, succeeded, failed, annualDripsCreated });
}

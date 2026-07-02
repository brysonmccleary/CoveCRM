import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import AffiliatePayoutLedger from "@/models/AffiliatePayoutLedger";
import User from "@/models/User";

type MoneyBucket = {
  count: number;
  cents: number;
  usd: number;
};

type PayoutStats = {
  held: MoneyBucket;
  clearedPayableNow: MoneyBucket;
  paid: MoneyBucket;
  reversed: MoneyBucket;
  clawbackOwed: MoneyBucket;
  processing: MoneyBucket;
  oldestProcessingStartedAt: Date | null;
};

function emptyBucket(): MoneyBucket {
  return { count: 0, cents: 0, usd: 0 };
}

function emptyStats(): PayoutStats {
  return {
    held: emptyBucket(),
    clearedPayableNow: emptyBucket(),
    paid: emptyBucket(),
    reversed: emptyBucket(),
    clawbackOwed: emptyBucket(),
    processing: emptyBucket(),
    oldestProcessingStartedAt: null,
  };
}

function toUsd(cents: number) {
  return Math.round(cents) / 100;
}

function addBucket(
  row: PayoutStats,
  key:
    | "held"
    | "clearedPayableNow"
    | "paid"
    | "reversed"
    | "clawbackOwed"
    | "processing",
  count: number,
  cents: number,
) {
  row[key] = {
    count,
    cents,
    usd: toUsd(cents),
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user || (session.user as any).role !== "admin") {
    return res.status(403).json({ error: "Admin only" });
  }

  await dbConnect();

  const now = new Date();
  const affiliates = await Affiliate.find({})
    .select({
      name: 1,
      email: 1,
      promoCode: 1,
      referralCode: 1,
      userId: 1,
      approved: 1,
      stripeConnectId: 1,
      onboardingCompleted: 1,
      connectedAccountStatus: 1,
    })
    .lean();

  const ownerIds = affiliates.map((affiliate: any) => affiliate.userId).filter(Boolean);
  const owners = await User.find({ _id: { $in: ownerIds } })
    .select({ email: 1, subscriptionStatus: 1, billingBlocked: 1 })
    .lean();
  const ownerById = new Map(owners.map((owner: any) => [String(owner._id), owner]));

  const ledgerAgg = await AffiliatePayoutLedger.aggregate([
    {
      $group: {
        _id: {
          affiliateId: "$affiliateId",
          status: "$status",
          payableNow: {
            $and: [
              { $eq: ["$status", "held"] },
              { $lte: ["$payableAt", now] },
              { $eq: [{ $ifNull: ["$reversedAt", null] }, null] },
            ],
          },
        },
        count: { $sum: 1 },
        cents: { $sum: { $ifNull: ["$amountCents", 0] } },
        oldestProcessingStartedAt: {
          $min: {
            $cond: [
              { $eq: ["$status", "processing"] },
              "$processingStartedAt",
              null,
            ],
          },
        },
      },
    },
  ]);

  const statsByAffiliate = new Map<string, PayoutStats>();

  for (const item of ledgerAgg as any[]) {
    const affiliateId = String(item?._id?.affiliateId || "");
    if (!affiliateId) continue;
    const status = String(item?._id?.status || "");
    const payableNow = Boolean(item?._id?.payableNow);
    const stats =
      statsByAffiliate.get(affiliateId) ||
      emptyStats();

    const count = Number(item.count || 0);
    const cents = Number(item.cents || 0);

    if (status === "held") addBucket(stats, "held", count, cents);
    if (payableNow) addBucket(stats, "clearedPayableNow", count, cents);
    if (status === "paid") addBucket(stats, "paid", count, cents);
    if (status === "reversed") addBucket(stats, "reversed", count, cents);
    if (status === "clawback_owed") addBucket(stats, "clawbackOwed", count, cents);
    if (status === "processing") {
      addBucket(stats, "processing", count, cents);
      stats.oldestProcessingStartedAt = item.oldestProcessingStartedAt || null;
    }

    statsByAffiliate.set(affiliateId, stats);
  }

  const rows = affiliates.map((affiliate: any) => {
    const affiliateId = String(affiliate._id);
    const owner = affiliate.userId ? ownerById.get(String(affiliate.userId)) : null;
    const stats = statsByAffiliate.get(affiliateId) || emptyStats();
    const affiliateActiveForPayout =
      Boolean(owner) &&
      owner?.subscriptionStatus === "active" &&
      owner?.billingBlocked !== true;

    return {
      affiliateId,
      name: affiliate.name || "",
      email: affiliate.email || "",
      promoCode: affiliate.promoCode || "",
      referralCode: affiliate.referralCode || null,
      approved: affiliate.approved === true,
      connectedAccountStatus: affiliate.connectedAccountStatus || "pending",
      onboardingCompleted: affiliate.onboardingCompleted === true,
      hasStripeConnectId: Boolean(affiliate.stripeConnectId),
      affiliateOwner: owner
        ? {
            email: owner.email || "",
            subscriptionStatus: owner.subscriptionStatus || "",
            billingBlocked: owner.billingBlocked === true,
            activeForPayout: affiliateActiveForPayout,
          }
        : null,
      totals: stats,
    };
  });

  rows.sort((a, b) => {
    const byPayable =
      b.totals.clearedPayableNow.cents - a.totals.clearedPayableNow.cents;
    if (byPayable !== 0) return byPayable;
    return String(a.email).localeCompare(String(b.email));
  });

  return res.status(200).json({
    ok: true,
    generatedAt: now.toISOString(),
    count: rows.length,
    rows,
  });
}

import UsageAccrualLedger, {
  type UsageAccrualBucket,
} from "@/models/UsageAccrualLedger";

export type RecordUsageAccrualResult = {
  accrued: boolean;
  duplicate: boolean;
  amountCents: number;
};

export async function recordUsageAccrualOnce(args: {
  bucket: UsageAccrualBucket;
  userEmail: string;
  eventKey: string;
  source: string;
  amountCents: number;
  origin?: "dialer" | "regular" | null;
  metadata?: Record<string, unknown>;
}): Promise<RecordUsageAccrualResult> {
  const email = String(args.userEmail || "").trim().toLowerCase();
  const eventKey = String(args.eventKey || "").trim();
  const amountCents = Math.max(0, Math.round(Number(args.amountCents || 0)));
  if (!email || !eventKey || amountCents <= 0) {
    return { accrued: false, duplicate: false, amountCents: 0 };
  }

  try {
    const existing = await UsageAccrualLedger.findOneAndUpdate(
      { eventKey },
      {
        $setOnInsert: {
          bucket: args.bucket,
          userEmail: email,
          eventKey,
          source: args.source,
          origin: args.origin || null,
          amountCents,
          billedCents: 0,
          status: "accrued",
          metadata: args.metadata || {},
          accruedAt: new Date(),
        },
      },
      { upsert: true, new: false },
    ).lean();

    if (existing) {
      return { accrued: false, duplicate: true, amountCents: Number((existing as any).amountCents || 0) };
    }
    return { accrued: true, duplicate: false, amountCents };
  } catch (err: any) {
    if (err?.code === 11000) {
      return { accrued: false, duplicate: true, amountCents };
    }
    throw err;
  }
}

export async function consumeAccrualLedgerCents(args: {
  bucket: UsageAccrualBucket;
  userEmail: string;
  amountCents: number;
}): Promise<number> {
  const email = String(args.userEmail || "").trim().toLowerCase();
  let remaining = Math.max(0, Math.round(Number(args.amountCents || 0)));
  if (!email || remaining <= 0) return 0;

  const rows = await UsageAccrualLedger.find({
    bucket: args.bucket,
    userEmail: email,
    status: "accrued",
    $expr: { $lt: ["$billedCents", "$amountCents"] },
  })
    .sort({ accruedAt: 1, createdAt: 1 })
    .limit(500)
    .select("_id amountCents billedCents")
    .lean();

  let consumed = 0;
  for (const row of rows as any[]) {
    if (remaining <= 0) break;
    const amount = Number(row.amountCents || 0);
    const billed = Number(row.billedCents || 0);
    const available = Math.max(0, amount - billed);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    const nextBilled = billed + take;
    const result = await UsageAccrualLedger.updateOne(
      { _id: row._id, billedCents: billed },
      {
        $set: {
          billedCents: nextBilled,
          ...(nextBilled >= amount ? { status: "billed", billedAt: new Date() } : {}),
        },
      },
    );
    if (Number((result as any)?.modifiedCount || 0) > 0) {
      consumed += take;
      remaining -= take;
    }
  }
  return consumed;
}

export async function getPendingAccrualLedgerCents(args: {
  bucket: UsageAccrualBucket;
  userEmail: string;
}): Promise<number> {
  const email = String(args.userEmail || "").trim().toLowerCase();
  if (!email) return 0;
  const rows = await UsageAccrualLedger.aggregate([
    {
      $match: {
        bucket: args.bucket,
        userEmail: email,
        status: "accrued",
      },
    },
    {
      $group: {
        _id: null,
        cents: {
          $sum: {
            $cond: [
              { $gt: [{ $subtract: ["$amountCents", "$billedCents"] }, 0] },
              { $subtract: ["$amountCents", "$billedCents"] },
              0,
            ],
          },
        },
      },
    },
  ]).exec();
  return Math.max(0, Number(rows?.[0]?.cents || 0));
}

export async function getExpectedUnbilledAccrualCents(args: {
  bucket: UsageAccrualBucket;
  userEmail?: string;
}): Promise<number> {
  const match: Record<string, unknown> = { bucket: args.bucket, status: "accrued" };
  if (args.userEmail) match.userEmail = String(args.userEmail).toLowerCase();
  const rows = await UsageAccrualLedger.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        cents: {
          $sum: {
            $cond: [
              { $gt: [{ $subtract: ["$amountCents", "$billedCents"] }, 0] },
              { $subtract: ["$amountCents", "$billedCents"] },
              0,
            ],
          },
        },
      },
    },
  ]).exec();
  return Number(rows?.[0]?.cents || 0);
}

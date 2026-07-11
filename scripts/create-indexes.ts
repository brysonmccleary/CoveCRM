// /scripts/create-indexes.ts
// Build/repair indexes safely. Re-runnable.
// - Skips "IndexOptionsConflict" for already-present indexes
// - Upgrades Message.sid index to unique+partial if needed

import "dotenv/config";
import mongooseConnect from "../lib/mongooseConnect";
import Message from "../models/Message";
import CallLog from "../models/CallLog";
import BillingEvent from "../models/BillingEvent";
import UsageAccrualLedger from "../models/UsageAccrualLedger";

type AnyIndex = {
  name?: string;
  key: Record<string, 1 | -1>;
  unique?: boolean;
  partialFilterExpression?: Record<string, any>;
  sparse?: boolean;
};

async function ensureIndexIndividually(
  col: any,
  spec: AnyIndex
) {
  try {
    // omit name to avoid name collisions when key already exists
    const { name: _omit, ...opts } = spec as any;
    await col.createIndex(spec.key, opts);
    console.log(`✅ ensured index on ${JSON.stringify(spec.key)}`);
  } catch (e: any) {
    if (e?.code === 85 /* IndexOptionsConflict */) {
      console.log(`ℹ️  index exists with a different name/options, skipping: ${JSON.stringify(spec.key)}`);
      return;
    }
    throw e;
  }
}

async function upgradeSidIndexIfNeeded(col: any) {
  const idxs = await col.indexes();
  const sidIx = idxs.find((ix: any) => JSON.stringify(ix.key) === JSON.stringify({ sid: 1 }));
  // We require: unique + partialFilterExpression on { sid: { $exists: true, $type: "string" } }
  const needsUpgrade =
    !sidIx ||
    sidIx.unique !== true ||
    !sidIx.partialFilterExpression;

  if (!needsUpgrade) return;

  if (sidIx) {
    console.log(`🔧 dropping existing sid index "${sidIx.name}" to recreate with unique + partial`);
    await col.dropIndex(sidIx.name);
  }

  await col.createIndex(
    { sid: 1 },
    {
      unique: true,
      partialFilterExpression: { sid: { $exists: true, $type: "string" } },
      // no explicit name — let Mongo derive it to avoid conflicts later
    },
  );
  console.log("✅ upgraded sid index to unique + partial");
}

async function ensureMessageIndexes() {
  const col = Message.collection;
  // Upgrade/fix SID first (so later creations don't clash)
  await upgradeSidIndexIfNeeded(col);

  const specs: AnyIndex[] = [
    { key: { userEmail: 1, leadId: 1, createdAt: -1 } },
    { key: { userEmail: 1, leadId: 1, read: 1, createdAt: -1 } },
    { key: { userEmail: 1, createdAt: -1 } },
    { key: { userEmail: 1, kind: 1, direction: 1, status: 1, createdAt: -1 } },
    { key: { userEmail: 1, from: 1, to: 1, createdAt: -1 } },
    // sid handled separately above
  ];

  for (const spec of specs) {
    await ensureIndexIndividually(col, spec);
  }
}

async function ensureCallLogIndexes() {
  const col = CallLog.collection;

  const specs: AnyIndex[] = [
    { key: { userEmail: 1, timestamp: -1 } },
    { key: { userEmail: 1, status: 1, timestamp: -1 } },
    {
      key: { userEmail: 1, direction: 1, kind: 1, timestamp: -1 },
      // Only enforce when fields exist; avoids conflicts on sparse data
      partialFilterExpression: {
        direction: { $exists: true, $type: "string" },
        kind: { $exists: true, $type: "string" },
      },
    },
    { key: { phoneNumber: 1, timestamp: -1 } },
  ];

  for (const spec of specs) {
    await ensureIndexIndividually(col, spec);
  }
}

export async function ensureBillingIndexes(col: any = UsageAccrualLedger.collection) {
  const indexes = await col.indexes();
  const isLegacyEventKeyIndex = (index: any) =>
    index?.name === "eventKey_1" &&
    index?.unique === true &&
    JSON.stringify(index?.key) === JSON.stringify({ eventKey: 1 });
  const isCompoundLedgerIndex = (index: any) =>
    index?.unique === true &&
    JSON.stringify(index?.key) === JSON.stringify({ userEmail: 1, bucket: 1, eventKey: 1 });
  const legacy = indexes.find(isLegacyEventKeyIndex);
  const compound = indexes.find(isCompoundLedgerIndex);
  console.log(`[BILLING INDEX] legacy eventKey_1 exists: ${Boolean(legacy)}`);
  console.log(`[BILLING INDEX] compound tenant/bucket/eventKey exists: ${Boolean(compound)}`);

  const duplicates = await col.aggregate([
    {
      $group: {
        _id: { userEmail: "$userEmail", bucket: "$bucket", eventKey: "$eventKey" },
        count: { $sum: 1 },
        ids: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $limit: 100 },
  ]).toArray();
  if (duplicates.length) {
    throw new Error(`[BILLING INDEX] duplicate tenant/bucket/eventKey rows: ${JSON.stringify(duplicates.map((row: any) => row.ids))}`);
  }

  if (legacy) {
    await col.dropIndex("eventKey_1");
    console.log("[BILLING INDEX] legacy eventKey_1 dropped: true");
  } else {
    console.log("[BILLING INDEX] legacy eventKey_1 dropped: false");
  }
  if (!compound) {
    await col.createIndex(
      { userEmail: 1, bucket: 1, eventKey: 1 },
      { unique: true, name: "usage_accrual_tenant_bucket_event" },
    );
    console.log("[BILLING INDEX] compound tenant/bucket/eventKey created: true");
  } else {
    console.log("[BILLING INDEX] compound tenant/bucket/eventKey created: false");
  }
  await BillingEvent.createIndexes();
  console.log("✅ ensured BillingEvent idempotency index");
}

export async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || "";
  if (!uri) {
    console.error("❌ Missing MONGODB_URI in environment.");
    process.exit(1);
  }

  await mongooseConnect();

  await ensureMessageIndexes();
  await ensureCallLogIndexes();
  await ensureBillingIndexes();

  console.log("🎉 All indexes ensured.");
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Failed to create indexes:", err);
    process.exit(1);
  });
}

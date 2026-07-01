// READ-ONLY billing balance audit. Makes zero writes.
// Usage: MONGODB_URI=... npx tsx scripts/audit-billing-balances.ts
import mongoose from "mongoose";

const FIELDS = {
  email: 1,
  name: 1,
  stripeCustomerId: 1,
  hasAI: 1,
  hasEverPaid: 1,
  billingBlocked: 1,
  aiDialerAccruedCents: 1,
  aiDialerAccruedSessionCents: 1,
  usageAccruedCents: 1,
  aiDialerBilledTotalCents: 1,
  usageBilledTotalCents: 1,
  aiDialerBillingLockAt: 1,
  aiDialerBillingLockOwner: 1,
  aiDialerBillingLockExpiresAt: 1,
} as const;

function printUser(u: any) {
  console.log(JSON.stringify({
    _id: String(u._id),
    email: u.email,
    name: u.name,
    stripeCustomerId: u.stripeCustomerId || null,
    hasAI: u.hasAI ?? null,
    hasEverPaid: u.hasEverPaid ?? null,
    billingBlocked: u.billingBlocked ?? null,
    aiDialerAccruedCents: u.aiDialerAccruedCents ?? 0,
    aiDialerAccruedSessionCents: u.aiDialerAccruedSessionCents ?? 0,
    usageAccruedCents: u.usageAccruedCents ?? 0,
    aiDialerBilledTotalCents: u.aiDialerBilledTotalCents ?? 0,
    usageBilledTotalCents: u.usageBilledTotalCents ?? 0,
    aiDialerBillingLockAt: u.aiDialerBillingLockAt ?? null,
    aiDialerBillingLockOwner: u.aiDialerBillingLockOwner ?? null,
    aiDialerBillingLockExpiresAt: u.aiDialerBillingLockExpiresAt ?? null,
  }, null, 2));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required");
  await mongoose.connect(uri);
  const db = mongoose.connection.db!;
  const users = db.collection("users");
  const sessions = db.collection("aicallsessions");

  console.log("=== 1) DRAKE ===");
  const drakes = await users
    .find(
      { $or: [{ email: /drake/i }, { name: /drake/i }] },
      { projection: FIELDS },
    )
    .toArray();
  if (!drakes.length) console.log("No user matching /drake/i found");
  drakes.forEach(printUser);

  console.log("\n=== 2) TOP 50 USERS WITH ANY ACCRUAL > 0 ===");
  const high = await users
    .aggregate([
      {
        $match: {
          $or: [
            { aiDialerAccruedCents: { $gt: 0 } },
            { aiDialerAccruedSessionCents: { $gt: 0 } },
            { usageAccruedCents: { $gt: 0 } },
          ],
        },
      },
      {
        $addFields: {
          totalAccrued: {
            $add: [
              { $ifNull: ["$aiDialerAccruedCents", 0] },
              { $ifNull: ["$aiDialerAccruedSessionCents", 0] },
              { $ifNull: ["$usageAccruedCents", 0] },
            ],
          },
        },
      },
      { $sort: { totalAccrued: -1 } },
      { $limit: 50 },
      { $project: { ...FIELDS, totalAccrued: 1 } },
    ])
    .toArray();
  console.log(`count: ${high.length}`);
  for (const u of high) {
    console.log(
      [
        `$${(u.totalAccrued / 100).toFixed(2)} total`,
        `email=${u.email}`,
        `name=${u.name || ""}`,
        `aiLegacy=${u.aiDialerAccruedCents || 0}c`,
        `aiSession=${u.aiDialerAccruedSessionCents || 0}c`,
        `usage=${u.usageAccruedCents || 0}c`,
        `billedAI=${u.aiDialerBilledTotalCents || 0}c`,
        `billedUsage=${u.usageBilledTotalCents || 0}c`,
        `hasEverPaid=${u.hasEverPaid ?? null}`,
        `lockOwner=${u.aiDialerBillingLockOwner || null}`,
      ].join(" | "),
    );
  }

  console.log("\n=== 3) USERS WITH STALE BILLING LOCKS ===");
  const lockedUsers = await users
    .find(
      { aiDialerBillingLockOwner: { $nin: [null, ""] } },
      { projection: FIELDS },
    )
    .toArray();
  console.log(`count: ${lockedUsers.length}`);
  lockedUsers.forEach(printUser);

  console.log("\n=== 4) ACTIVE / STUCK AI CALL SESSIONS ===");
  const active = await sessions
    .find(
      { status: { $in: ["running", "active", "in_progress", "started", "paused"] } },
      {
        projection: {
          userEmail: 1, status: 1, startedAt: 1, stoppedAt: 1,
          billedSeconds: 1, lastWorkerKickAt: 1, lastCallbackAt: 1, lastBilledAt: 1,
        },
      },
    )
    .sort({ startedAt: -1 })
    .limit(50)
    .toArray();
  console.log(`count: ${active.length}`);
  for (const s of active) {
    console.log(JSON.stringify({
      _id: String(s._id),
      userEmail: s.userEmail,
      status: s.status,
      startedAt: s.startedAt,
      stoppedAt: s.stoppedAt ?? null,
      billedSeconds: s.billedSeconds ?? 0,
      lastWorkerKickAt: s.lastWorkerKickAt ?? null,
      lastCallbackAt: s.lastCallbackAt ?? null,
      lastBilledAt: s.lastBilledAt ?? null,
    }));
  }

  // Also show distinct statuses so we don't miss a naming variant
  const statuses = await sessions.aggregate([
    { $group: { _id: "$status", n: { $sum: 1 } } }, { $sort: { n: -1 } },
  ]).toArray();
  console.log("\nsession status counts:", JSON.stringify(statuses));

  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

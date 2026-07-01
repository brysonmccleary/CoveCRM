// One-time confirmed repair: zero Drake's AI accrual fields + clear AI billing locks.
// Does NOT touch usageAccruedCents, billed lifetime totals, or BillingEvent records.
import mongoose from "mongoose";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI required");
  await mongoose.connect(uri);
  const users = mongoose.connection.db!.collection("users");

  const filter = {
    _id: new mongoose.Types.ObjectId("6a174569bc0815da84dfaa94"),
    email: "drakeboren5@gmail.com",
  };

  const result = await users.updateOne(filter, {
    $set: {
      aiDialerAccruedSessionCents: 0,
      aiDialerAccruedCents: 0,
      aiDialerBillingLockAt: null,
      aiDialerBillingLockOwner: null,
      aiDialerBillingLockExpiresAt: null,
    },
  });
  console.log("matched:", result.matchedCount, "modified:", result.modifiedCount);

  const after = await users.findOne(filter, {
    projection: {
      email: 1,
      aiDialerAccruedCents: 1,
      aiDialerAccruedSessionCents: 1,
      usageAccruedCents: 1,
      aiDialerBilledTotalCents: 1,
      usageBilledTotalCents: 1,
      aiDialerBillingLockAt: 1,
      aiDialerBillingLockOwner: 1,
      aiDialerBillingLockExpiresAt: 1,
    },
  });
  console.log("AFTER:", JSON.stringify(after, null, 2));
  await mongoose.disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

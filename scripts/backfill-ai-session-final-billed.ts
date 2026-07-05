import "dotenv/config";
import mongoose from "mongoose";
import AICallSession from "@/models/AICallSession";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is required");

  const dryRun = process.env.DRY_RUN !== "0";
  await mongoose.connect(uri);

  const filter = {
    status: { $in: ["completed", "stopped"] },
    finalBilledAt: null,
  };

  const count = await AICallSession.countDocuments(filter);
  console.log("[AI session final-billed backfill]", {
    dryRun,
    matchingSessions: count,
  });

  if (!dryRun && count > 0) {
    const now = new Date();
    const result = await AICallSession.updateMany(filter, {
      $set: { finalBilledAt: now },
    });
    console.log("[AI session final-billed backfill] updated", {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      finalBilledAt: now,
    });
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});

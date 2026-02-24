import dbConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";

async function main() {
  await dbConnect();
  const now = new Date();

  const dueQuery: any = {
    status: "active",
    nextSendAt: { $lte: now },
    processing: { $ne: true },
    $and: [
      { $or: [{ active: { $ne: false } }, { isActive: true }, { enabled: true }] },
      { $or: [{ paused: { $ne: true } }, { isPaused: { $ne: true } }] },
      { stopAll: { $ne: true } },
    ],
  };

  const total = await DripEnrollment.countDocuments({});
  const active = await DripEnrollment.countDocuments({ status: "active" });
  const due = await DripEnrollment.countDocuments(dueQuery);
  const stuckProcessing = await DripEnrollment.countDocuments({
    status: "active",
    nextSendAt: { $lte: now },
    processing: true,
  });

  const sample = await DripEnrollment.find(dueQuery)
    .select({ _id: 1, userEmail: 1, leadId: 1, campaignId: 1, cursorStep: 1, nextSendAt: 1, processing: 1, lastError: 1, processingAt: 1 })
    .sort({ nextSendAt: 1 })
    .limit(5)
    .lean();

  console.log(JSON.stringify({
    now: now.toISOString(),
    total,
    active,
    due,
    stuckProcessing,
    sample
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

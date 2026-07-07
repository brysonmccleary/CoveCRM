import mongoose from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import {
  deriveInteractionContactFields,
  isSoldStatus,
} from "@/lib/leads/foundationFields";
import { timezoneForState } from "@/lib/leads/stateTimezone";

const BATCH_SIZE = 500;
const DRY_RUN = process.argv.includes("--dry");

type Counts = {
  scanned: number;
  timezone: number;
  contactFields: number;
  soldAt: number;
  writes: number;
};

function buildUpdateForLead(lead: any) {
  const setFields: Record<string, any> = {};

  if (!lead.timezone) {
    const timezone = timezoneForState(lead.State || lead.state || "");
    if (timezone) setFields.timezone = timezone;
  }

  const hasContactAttempts = Number(lead.contactAttempts || 0) > 0;
  const hasLastContactedAt = Boolean(lead.lastContactedAt);
  if (!hasContactAttempts || !hasLastContactedAt) {
    const derived = deriveInteractionContactFields(lead.interactionHistory || []);
    if (derived.contactAttempts > 0 && !hasContactAttempts) {
      setFields.contactAttempts = derived.contactAttempts;
    }
    if (derived.lastContactedAt && !hasLastContactedAt) {
      setFields.lastContactedAt = derived.lastContactedAt;
    }
  }

  if (isSoldStatus(lead.status) && !lead.soldAt) {
    setFields.soldAt = lead.updatedAt || lead.createdAt || new Date();
    setFields.soldAtApproximate = true;
  }

  return setFields;
}

async function run() {
  console.log(
    "Usage: npx tsx scripts/backfill-lead-foundations.ts --dry | npx tsx scripts/backfill-lead-foundations.ts",
  );
  console.log(`[lead-foundations-backfill] mode=${DRY_RUN ? "dry-run" : "write"}`);

  await mongooseConnect();

  const counts: Counts = {
    scanned: 0,
    timezone: 0,
    contactFields: 0,
    soldAt: 0,
    writes: 0,
  };

  let lastId: mongoose.Types.ObjectId | null = null;
  for (;;) {
    const query: Record<string, any> = lastId ? { _id: { $gt: lastId } } : {};
    const leads = await Lead.find(query)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select({
        _id: 1,
        userEmail: 1,
        State: 1,
        state: 1,
        timezone: 1,
        interactionHistory: 1,
        contactAttempts: 1,
        lastContactedAt: 1,
        status: 1,
        soldAt: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .lean<any[]>();

    if (!leads.length) break;

    for (const lead of leads) {
      counts.scanned += 1;
      lastId = lead._id;

      const setFields = buildUpdateForLead(lead);
      if (!Object.keys(setFields).length) continue;

      if (Object.prototype.hasOwnProperty.call(setFields, "timezone")) counts.timezone += 1;
      if (
        Object.prototype.hasOwnProperty.call(setFields, "contactAttempts") ||
        Object.prototype.hasOwnProperty.call(setFields, "lastContactedAt")
      ) {
        counts.contactFields += 1;
      }
      if (Object.prototype.hasOwnProperty.call(setFields, "soldAt")) counts.soldAt += 1;
      counts.writes += 1;

      if (!DRY_RUN) {
        await Lead.updateOne(
          { _id: lead._id, userEmail: lead.userEmail },
          { $set: setFields },
        ).exec();
      }
    }

    if (leads.length < BATCH_SIZE) break;
  }

  console.log("[lead-foundations-backfill] counts", counts);
  if (DRY_RUN) console.log("[lead-foundations-backfill] dry run only; no writes performed");
}

run()
  .catch((err) => {
    console.error("[lead-foundations-backfill] failed", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });

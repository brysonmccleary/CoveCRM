// scripts/promote-doi-raw-to-agent.ts
// Stage 3 of the DOI ingest pipeline: upsert normalized DOIRawRecords into DOIAgent.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIRawRecord from "../models/DOIRawRecord";
import DOIAgent from "../models/DOIAgent";
import EmailVerification from "../models/EmailVerification";
import type { Types } from "mongoose";

const BATCH_SIZE = 100;

function buildAgentFilter(state: string, licenseNumber: string, npn?: string) {
  if (npn) return { npn };
  if (licenseNumber) return { state, licenseNumber };
  return null;
}

async function queueSourceEmail(agentId: Types.ObjectId, email: string, source: string) {
  const normalized = email.toLowerCase().trim();
  if (!normalized || !normalized.includes("@")) return;
  await EmailVerification.updateOne(
    { agentId, email: normalized },
    {
      $setOnInsert: {
        patternUsed: source || "source",
        smtpValid: false,
        confidenceScore: 70,
      },
      $set: { verifiedAt: null },
    },
    { upsert: true }
  );
}

export type PromoteSummary = {
  processed: number;
  promoted: number;
  updated: number;
  skipped: number;
  errors: number;
};

export async function runPromoteDOIRaw(batchSize = BATCH_SIZE): Promise<PromoteSummary> {
  const summary: PromoteSummary = {
    processed: 0,
    promoted: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
  };

  const candidates = await DOIRawRecord.find({ parseStatus: "normalized" })
    .sort({ updatedAt: 1 })
    .limit(batchSize)
    .select("_id")
    .lean();

  for (const candidate of candidates) {
    const rec = await DOIRawRecord.findOneAndUpdate(
      { _id: candidate._id, parseStatus: "normalized" },
      {
        $set: {
          parseStatus: "promotion_pending",
          rejectionReason: "",
          promotionError: "",
          lastPromotionAt: new Date(),
        },
        $inc: { promotionAttempts: 1 },
      },
      { new: true }
    ).lean();

    if (!rec) continue;
    summary.processed++;
    try {
      const filter = buildAgentFilter(
        rec.state || "",
        rec.rawLicenseNumber || "",
        rec.rawNpn || ""
      );

      if (!filter) {
        await DOIRawRecord.updateOne(
          { _id: rec._id },
          { $set: { parseStatus: "rejected", rejectionReason: "no_filter_key" } }
        );
        summary.skipped++;
        continue;
      }

      const now = new Date();
      const updateResult = await DOIAgent.updateOne(
        filter,
        {
          $set: {
            firstName: rec.rawFirstName || "",
            lastName: rec.rawLastName || "",
            phone: rec.rawPhone || "",
            state: rec.state || "",
            city: rec.rawCity || "",
            licenseType: rec.rawLicenseType || "",
            licenseNumber: rec.rawLicenseNumber || "",
            licenseStatus: "Active",
            npn: rec.rawNpn || "",
            source: rec.source,
            lastCheckedAt: now,
          },
          $setOnInsert: {
            enrichmentStatus: "pending",
            confidenceScore: 0,
          },
        },
        { upsert: true, setDefaultsOnInsert: true }
      );

      let doc: any = null;
      let wasExisting = true;
      if (updateResult.upsertedCount && updateResult.upsertedId) {
        wasExisting = false;
        doc = await DOIAgent.findById(updateResult.upsertedId);
      } else {
        doc = await DOIAgent.findOne(filter);
      }

      if (!doc?._id) {
        await DOIRawRecord.updateOne(
          { _id: rec._id },
          { $set: { parseStatus: "rejected", rejectionReason: "upsert_no_doc" } }
        );
        summary.skipped++;
        continue;
      }

      if (rec.rawEmail && rec.rawEmail.includes("@")) {
        await queueSourceEmail(doc._id as Types.ObjectId, rec.rawEmail, rec.source);
      }

      await DOIRawRecord.updateOne(
        { _id: rec._id },
        {
          $set: {
            parseStatus: "promoted",
            promotedAgentId: doc._id,
            promotedAt: now,
            promotionError: "",
          },
        }
      );

      if (wasExisting) summary.updated++;
      else summary.promoted++;
    } catch (err: any) {
      if (err?.code === 11000) {
        try {
          await DOIRawRecord.updateOne(
            { _id: rec._id },
            { $set: { parseStatus: "rejected", rejectionReason: "duplicate" } }
          );
        } catch { /* ignore */ }
        summary.skipped++;
      } else {
        summary.errors++;
        console.error("[promote-doi-raw] error on record", rec._id, err?.message);
        try {
          await DOIRawRecord.updateOne(
            { _id: rec._id },
            {
              $set: {
                parseStatus: "failed",
                promotionError: err?.message || "unknown",
              },
            }
          );
        } catch { /* ignore */ }
      }
    }
  }

  return summary;
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await runPromoteDOIRaw();
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    process.exit(0);
  })().catch((err) => {
    console.error("[promote-doi-raw-to-agent] Fatal:", err?.message || err);
    process.exit(1);
  });
}

// scripts/normalize-doi-raw.ts
// Stage 2 of the DOI ingest pipeline: classify pending DOIRawRecords.
// Sets parseStatus = "normalized" (isRelevantLifeHealth=true) or "rejected".
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIRawRecord from "../models/DOIRawRecord";

const NEGATIVE_STATUS_TERMS = [
  "inactive", "suspend", "revoked", "terminated", "expired", "canceled",
];
const BATCH_SIZE = 500;
const MAX_SAMPLES = 5;

function isRelevantLifeHealth(licenseType: string, lineOfAuthority: string): boolean {
  const combined = `${licenseType} ${lineOfAuthority}`.toUpperCase();
  return (
    combined.includes("LIFE") ||
    combined.includes("HEALTH") ||
    combined.includes("2-14") ||
    combined.includes("2-15") ||
    combined.includes("2-16") ||
    combined.includes("2-40") ||
    combined.includes("L&H") ||
    combined.includes("ANNUITY") ||
    combined.includes("VARIABLE")
  );
}

export type NormalizeSummary = {
  processed: number;
  normalized: number;
  rejected: number;
  errors: number;
  rejectionBuckets: Record<string, number>;
  samples: Array<{
    source: string;
    state: string;
    name: string;
    licenseType: string;
    licenseStatus: string;
    licenseNumber: string;
    npn: string;
  }>;
};

export async function runNormalizeDOIRaw(batchSize = BATCH_SIZE): Promise<NormalizeSummary> {
  const summary: NormalizeSummary = {
    processed: 0,
    normalized: 0,
    rejected: 0,
    errors: 0,
    rejectionBuckets: {},
    samples: [],
  };

  const candidates = await DOIRawRecord.find({ parseStatus: "pending" })
    .sort({ createdAt: 1 })
    .limit(batchSize)
    .select("_id")
    .lean();

  for (const candidate of candidates) {
    const claimed = await DOIRawRecord.findOneAndUpdate(
      { _id: candidate._id, parseStatus: "pending" },
      {
        $set: {
          parseStatus: "normalizing",
          normalizeError: "",
          rejectionReason: "",
          lastNormalizeAt: new Date(),
        },
        $inc: { normalizeAttempts: 1 },
      },
      { new: true }
    ).lean();

    if (!claimed) continue;
    summary.processed++;
    try {
      const rawStatus = (claimed.rawLicenseStatus || "").toLowerCase();
      const isBadStatus =
        rawStatus !== "" &&
        NEGATIVE_STATUS_TERMS.some((t) => rawStatus.includes(t));

      if (isBadStatus) {
        await DOIRawRecord.updateOne(
          { _id: claimed._id },
          {
            $set: {
              parseStatus: "rejected",
              rejectionReason: "negative_status",
              normalizeError: "",
            },
          }
        );
        summary.rejected++;
        summary.rejectionBuckets["negative_status"] =
          (summary.rejectionBuckets["negative_status"] || 0) + 1;
        continue;
      }

      const relevant = isRelevantLifeHealth(
        claimed.rawLicenseType || "",
        claimed.rawLineOfAuthority || ""
      );

      if (!relevant) {
        await DOIRawRecord.updateOne(
          { _id: claimed._id },
          {
            $set: {
              parseStatus: "rejected",
              rejectionReason: "not_life_health",
              isRelevantLifeHealth: false,
            },
          }
        );
        summary.rejected++;
        summary.rejectionBuckets["not_life_health"] =
          (summary.rejectionBuckets["not_life_health"] || 0) + 1;
        continue;
      }

      await DOIRawRecord.updateOne(
        { _id: claimed._id },
        {
          $set: {
            parseStatus: "normalized",
            isRelevantLifeHealth: true,
            normalizeError: "",
            rejectionReason: "",
          },
        }
      );
      summary.normalized++;

      if (summary.samples.length < MAX_SAMPLES) {
        summary.samples.push({
          source: claimed.source,
          state: claimed.state || "",
          name: `${claimed.rawFirstName || ""} ${claimed.rawLastName || ""}`.trim(),
          licenseType: claimed.rawLicenseType || "",
          licenseStatus: claimed.rawLicenseStatus || "(blank)",
          licenseNumber: claimed.rawLicenseNumber || "(blank)",
          npn: claimed.rawNpn || "(blank)",
        });
      }
    } catch (err: any) {
      summary.errors++;
      console.error("[normalize-doi-raw] error on record", candidate._id, err?.message);
      try {
        await DOIRawRecord.updateOne(
          { _id: candidate._id },
          {
            $set: {
              parseStatus: "failed",
              normalizeError: err?.message || "unknown",
            },
          }
        );
      } catch { /* ignore */ }
    }
  }

  return summary;
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await runNormalizeDOIRaw();
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    if (summary.samples.length) {
      console.log("[normalize-doi-raw] Sample normalized records:");
      summary.samples.forEach((s, i) => {
        console.log(
          `  #${i + 1}: ${s.name} | ${s.licenseType} | status=${s.licenseStatus} | lic=${s.licenseNumber} | npn=${s.npn}`
        );
      });
    }
    process.exit(0);
  })().catch((err) => {
    console.error("[normalize-doi-raw] Fatal:", err?.message || err);
    process.exit(1);
  });
}

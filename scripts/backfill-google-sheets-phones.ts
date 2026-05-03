import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import { extractPhoneFromRow } from "@/lib/leads/phoneMapping";

function hasValue(value: unknown) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeKey(key: unknown) {
  return String(key ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function objectKeys(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];
}

function parseRawRow(rawRow: unknown) {
  if (!rawRow) return null;
  if (rawRow && typeof rawRow === "object" && !Array.isArray(rawRow)) return rawRow;
  if (typeof rawRow === "string") {
    try {
      const parsed = JSON.parse(rawRow);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function hasPhoneCandidate(value: unknown, seen = new WeakSet<object>(), depth = 0): boolean {
  if (depth > 8 || value === undefined || value === null) return false;

  if (typeof value !== "object") {
    const digits = String(value).replace(/\D/g, "");
    return digits.length > 0 && digits.length < 10;
  }

  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasPhoneCandidate(item, seen, depth + 1));
  }

  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (/phone|mobile|cell/.test(normalizeKey(key)) && hasValue(raw)) return true;
  }

  for (const raw of Object.values(value as Record<string, unknown>)) {
    if (raw && typeof raw === "object" && hasPhoneCandidate(raw, seen, depth + 1)) return true;
  }

  return false;
}

function pushSkippedSample(
  samples: Array<Record<string, unknown>>,
  lead: any,
  reason: string,
) {
  if (samples.length >= 10) return;
  const rawRow = parseRawRow(lead?.rawRow);
  samples.push({
    _id: String(lead?._id || ""),
    keys: objectKeys(lead).slice(0, 30),
    rawRowKeys: objectKeys(rawRow).slice(0, 30),
    reason,
  });
}

async function main() {
  const apply = String(process.env.APPLY || "").toLowerCase() === "true";
  const dryRun = !apply;

  await mongooseConnect();

  const query = {
    $and: [
      {
        $or: [
          { source: "google-sheets" },
          { externalId: /^gs:/ },
          { sheetMeta: { $exists: true } },
        ],
      },
      {
        $or: [
          { phone: { $exists: false } },
          { phone: "" },
          { normalizedPhone: { $exists: false } },
          { normalizedPhone: "" },
          { phoneLast10: { $exists: false } },
          { phoneLast10: "" },
        ],
      },
    ],
  };

  let scanned = 0;
  let changed = 0;
  let skippedNoPhone = 0;
  let skippedInvalid = 0;
  const skippedSamples: Array<Record<string, unknown>> = [];

  const cursor = (Lead as any).find(query).lean().cursor();

  for await (const lead of cursor) {
    scanned++;

    const extracted = extractPhoneFromRow(lead);
    if (!extracted.phone && !extracted.normalizedPhone) {
      const reason = hasPhoneCandidate(lead) ? "invalid_phone_candidate" : "no_phone_candidate";
      if (reason === "invalid_phone_candidate") skippedInvalid++;
      else skippedNoPhone++;
      pushSkippedSample(skippedSamples, lead, reason);
      continue;
    }

    const set: Record<string, any> = {};
    if (!hasValue((lead as any).phone) && extracted.phone) {
      set.phone = extracted.phone;
    }
    if (!hasValue((lead as any).normalizedPhone) && extracted.normalizedPhone) {
      set.normalizedPhone = extracted.normalizedPhone;
    }
    if (!hasValue((lead as any).phoneLast10) && extracted.phoneLast10) {
      set.phoneLast10 = extracted.phoneLast10;
    }

    if (!Object.keys(set).length) continue;

    if (!dryRun) {
      await (Lead as any).updateOne({ _id: (lead as any)._id }, { $set: set });
    }
    changed++;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        apply,
        scanned,
        ...(dryRun ? { wouldUpdate: changed } : { updated: changed }),
        skippedNoPhone,
        skippedInvalid,
        skippedSamples,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

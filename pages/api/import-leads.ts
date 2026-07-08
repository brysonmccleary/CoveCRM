// pages/api/import-leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "fs";
import csvParser from "csv-parser";
import { Readable } from "stream";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import LeadCustomField from "@/models/LeadCustomField";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { sanitizeLeadType, createLeadsFromCSV } from "@/lib/mongo/leads";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";
import { extractPhoneFromRow, normalizePhoneDigitsToE164 } from "@/lib/leads/phoneMapping";
import { ensureNonSystemFolderId } from "@/lib/folders/ensureNonSystemFolderId";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import {
  buildSoldAtTransitionSet,
  isSoldStatus,
  withDerivedTimezone,
} from "@/lib/leads/foundationFields";
import { timezoneForState } from "@/lib/leads/stateTimezone";
import {
  buildInsertCreatedAt,
  CANONICAL_TO_LEAD_FIELD,
  DONT_IMPORT,
  isDateAddedHeader,
  isCanonicalField,
  normalizeImportMapping,
  parseCustomFieldTarget,
  trimImportValue,
  type NormalizedImportMapping,
} from "@/lib/leads/importFieldRegistry";

// ✅ Extract inserted IDs from bulkWrite result (supports multiple driver shapes)
function getUpsertedIdsFromBulkWrite(result: any): string[] {
  try {
    const raw = result?.getUpsertedIds?.() ?? result?.upsertedIds;
    const ids: any[] = [];

    // raw could be: [{ index, _id }, ...]
    if (Array.isArray(raw)) {
      for (const it of raw) {
        const id = it?._id ?? it;
        if (id) ids.push(id);
      }
    }
    // raw could be: { "0": ObjectId("..."), "5": ObjectId("...") }
    else if (raw && typeof raw === "object") {
      for (const k of Object.keys(raw)) {
        const id = (raw as any)[k]?._id ?? (raw as any)[k];
        if (id) ids.push(id);
      }
    }

    return ids.map((x) => String(x)).filter(Boolean);
  } catch {
    return [];
  }
}


export const config = { api: { bodyParser: false } };

/* ---------------- tiny utils ---------------- */
function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}
function last10(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D+/g, "");
  const k = digits.slice(-10);
  return k || undefined;
}
function lcEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  const s = String(email).trim().toLowerCase();
  return s || undefined;
}
function lc(str?: string | null) {
  return str ? String(str).trim().toLowerCase() : undefined;
}

/* ---- state normalization ---- */
const STATE_MAP: Record<string, string> = {
  AL: "AL",
  ALABAMA: "AL",
  AK: "AK",
  ALASKA: "AK",
  AZ: "AZ",
  ARIZONA: "AZ",
  AR: "AR",
  ARKANSAS: "AR",
  CA: "CA",
  CALIFORNIA: "CA",
  CO: "CO",
  COLORADO: "CO",
  CT: "CT",
  CONNECTICUT: "CT",
  DE: "DE",
  DELAWARE: "DE",
  FL: "FL",
  FLORIDA: "FL",
  GA: "GA",
  GEORGIA: "GA",
  HI: "HI",
  HAWAII: "HI",
  ID: "ID",
  IDAHO: "ID",
  IL: "IL",
  ILLINOIS: "IL",
  IN: "IN",
  INDIANA: "IN",
  IA: "IA",
  IOWA: "IA",
  KS: "KS",
  KANSAS: "KS",
  KY: "KY",
  KENTUCKY: "KY",
  LA: "LA",
  LOUISIANA: "LA",
  ME: "ME",
  MAINE: "ME",
  MD: "MD",
  MARYLAND: "MD",
  MA: "MA",
  MASSACHUSETTS: "MA",
  MI: "MI",
  MICHIGAN: "MI",
  MN: "MN",
  MINNESOTA: "MN",
  MS: "MS",
  MISSISSIPPI: "MS",
  MO: "MO",
  MISSOURI: "MO",
  MT: "MT",
  MONTANA: "MT",
  NE: "NE",
  NEBRASKA: "NE",
  NV: "NV",
  NEVADA: "NV",
  NH: "NH",
  NEW_HAMPSHIRE: "NH",
  "NEW HAMPSHIRE": "NH",
  NJ: "NJ",
  NEW_JERSEY: "NJ",
  "NEW JERSEY": "NJ",
  NM: "NM",
  NEW_MEXICO: "NM",
  "NEW MEXICO": "NM",
  NY: "NY",
  NEW_YORK: "NY",
  "NEW YORK": "NY",
  NC: "NC",
  NORTH_CAROLINA: "NC",
  "NORTH CAROLINA": "NC",
  ND: "ND",
  NORTH_DAKOTA: "ND",
  "NORTH DAKOTA": "ND",
  OH: "OH",
  OHIO: "OH",
  OK: "OK",
  OKLAHOMA: "OK",
  OR: "OR",
  OREGON: "OR",
  PA: "PA",
  PENNSYLVANIA: "PA",
  RI: "RI",
  RHODE_ISLAND: "RI",
  "RHODE ISLAND": "RI",
  SC: "SC",
  SOUTH_CAROLINA: "SC",
  "SOUTH CAROLINA": "SC",
  SD: "SD",
  SOUTH_DAKOTA: "SD",
  "SOUTH DAKOTA": "SD",
  TN: "TN",
  TENNESSEE: "TN",
  TX: "TX",
  TEXAS: "TX",
  UT: "UT",
  UTAH: "UT",
  VT: "VT",
  VERMONT: "VT",
  VA: "VA",
  VIRGINIA: "VA",
  WA: "WA",
  WASHINGTON: "WA",
  WV: "WV",
  WEST_VIRGINIA: "WV",
  "WEST VIRGINIA": "WV",
  WI: "WI",
  WISCONSIN: "WI",
  WY: "WY",
  WYOMING: "WY",
  DC: "DC",
  "DISTRICT OF COLUMBIA": "DC",
  DISTRICT_OF_COLUMBIA: "DC",
};
function normalizeState(input?: string | null): string | undefined {
  if (!input) return undefined;
  const key = String(input).trim().toUpperCase();
  return (
    STATE_MAP[key] ||
    STATE_MAP[key.replace(/\s+/g, "_")] ||
    undefined
  );
}

/* ---- status formatting ---- */
function sanitizeStatus(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Folder resolver (NO AUTO FALLBACK) */
/* ------------------------------------------------------------------ */
async function selectImportFolder(
  userEmail: string,
  opts: { targetFolderId?: string; folderName?: string }
) {
  await dbConnect();

  const byName = (opts.folderName || "").trim();
  if (byName) {
    if (isSystemFolder(byName)) {
      const msg = "Cannot import into system folders";
      console.warn("Import blocked: system folder by NAME", { userEmail, byName });
      throw Object.assign(new Error(msg), { status: 400 });
    }
    // Exact match, create if missing
    const coll = mongoose.connection.db!.collection("folders");
    const found = await coll.findOne({ userEmail, name: byName });
    if (found) return { folder: found as any, selection: "foundByName" as const };

    const ins = await coll.insertOne({ userEmail, name: byName, assignedDrips: [] });
    const created = await coll.findOne({ _id: ins.insertedId });
    return { folder: created as any, selection: "createdByName" as const };
  }

  if (opts.targetFolderId) {
    const f = await Folder.findOne({ _id: opts.targetFolderId, userEmail });
    if (!f) {
      const msg = "Folder not found or not owned by user";
      console.warn("Import blocked: bad ID", {
        userEmail,
        targetFolderId: opts.targetFolderId,
      });
      throw Object.assign(new Error(msg), { status: 400 });
    }
    if (isSystemFolder(f.name)) {
      const msg = "Cannot import into system folders";
      console.warn("Import blocked: system folder by ID", {
        userEmail,
        folderId: String(f._id),
        folderName: f.name,
      });
      throw Object.assign(new Error(msg), { status: 400 });
    }
    return { folder: f, selection: "byId" as const };
  }

  const msg =
    "A folder is required: provide folderName (creates if missing) or targetFolderId.";
  console.warn("Import blocked: no folder provided", { userEmail });
  throw Object.assign(new Error(msg), { status: 400 });
}

/* ---- JSON body reader (for JSON mode) ---- */
type JsonPayload = {
  targetFolderId?: string;
  folderName?: string;
  newFolderName?: string;
  newFolder?: string;
  name?: string;
  mapping?: Record<string, string>;
  rows?: Record<string, any>[];
  skipExisting?: boolean;
  skipHeaders?: string[];
};
async function readJsonBody(req: NextApiRequest): Promise<JsonPayload | null> {
  if (!req.headers["content-type"]?.includes("application/json")) return null;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve());
    req.on("error", (e) => reject(e));
  });
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/* ---- CSV mapping ---- */
function normalizeHeaderKey(input?: string | null) {
  return String(input || "").trim().toLowerCase();
}

function buildSkippedHeaderSet(skipHeaders?: string[]) {
  return new Set(
    Array.isArray(skipHeaders)
      ? skipHeaders.map((h) => normalizeHeaderKey(h)).filter(Boolean)
      : []
  );
}

function collectHeaders(rows: Record<string, any>[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows || []) {
    for (const header of Object.keys(row || {})) {
      if (seen.has(header)) continue;
      seen.add(header);
      headers.push(header);
    }
  }
  return headers;
}

function mergeSkippedHeaders(mapping: NormalizedImportMapping, skipHeaders: string[]) {
  return Array.from(new Set([...(mapping.skipped || []), ...(skipHeaders || [])]));
}

async function upsertCustomFieldRegistry(userEmail: string, customFields: string[]) {
  const names = Array.from(new Set((customFields || []).map((name) => name.trim()).filter(Boolean)));
  if (!names.length) return;
  const firstSeenAt = new Date();
  await (LeadCustomField as any).bulkWrite(
    names.map((fieldName) => ({
      updateOne: {
        filter: { userEmail, fieldName },
        update: {
          $setOnInsert: {
            userEmail,
            fieldName,
            firstSeenAt,
            source: "csv_import",
          },
        },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

function mapRow(
  row: Record<string, any>,
  mapping: NormalizedImportMapping,
  skippedHeaders?: Set<string>,
  warnings: string[] = [],
  rowNumber = 0
) {
  const isSkipped = (header?: string | null) =>
    !!header && !!skippedHeaders?.has(normalizeHeaderKey(header));

  const lead: Record<string, any> = {};
  let dateAddedRaw: any;

  for (const [header, rawTarget] of Object.entries(mapping.headerToTarget || {})) {
    if (isSkipped(header)) continue;
    const target = String(rawTarget || "").trim();
    if (!target || target === DONT_IMPORT) continue;

    const rawValue = trimImportValue(row[header]);
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;

    if (isCanonicalField(target)) {
      const fieldName = CANONICAL_TO_LEAD_FIELD[target];
      if (target === "Email") {
        const email = lcEmail(rawValue);
        if (email) {
          lead.Email = email;
          lead.email = email;
        }
      } else if (target === "Lead Type") {
        lead.leadType = sanitizeLeadType(String(rawValue || ""));
      } else if (target === "Status") {
        lead.status = sanitizeStatus(String(rawValue || ""));
      } else if (target === "State") {
        lead.State = normalizeState(String(rawValue || ""));
      } else {
        lead[fieldName] = rawValue;
      }
      continue;
    }

    const customFieldName = parseCustomFieldTarget(target, header);
    if (isDateAddedHeader(customFieldName)) dateAddedRaw = rawValue;
    lead[customFieldName] = rawValue;
  }

  const source = lead.source;
  const notes = lead.Notes;

  const mergedNotes =
    source && notes
      ? `${notes} | Source: ${source}`
      : source && !notes
      ? `Source: ${source}`
      : notes;

  const normalizedState = lead.State;
  const timezone = timezoneForState(normalizedState || "");
  const phone = lead.Phone;
  const phoneDigits = phone ? String(phone).replace(/\D+/g, "") : "";
  const phoneKey = phoneDigits ? phoneDigits.slice(-10) : undefined;
  const normalizedPhone = normalizePhoneDigitsToE164(phoneDigits) || undefined;
  const status = lead.status || "New";
  const createdAtWarnings: string[] = [];
  const createdAtFallback = new Date();
  const createdAtOverride = dateAddedRaw
    ? buildInsertCreatedAt(
        dateAddedRaw,
        createdAtFallback,
        createdAtWarnings,
        `Row ${rowNumber + 1} Date Added`,
      )
    : undefined;
  warnings.push(...createdAtWarnings);

  return {
    ...lead,
    phone: phoneDigits || undefined,
    phoneLast10: phoneKey,
    normalizedPhone,
    State: normalizedState,
    timezone,
    Notes: mergedNotes,
    status,
    __createdAtOverride: createdAtOverride,
  };
}
/* ---- dedupe helpers ---- */
function buildFilter(userEmail: string, folderId: any, phoneKey?: string, emailKey?: string) {
  if (phoneKey) {
    return { userEmail, folderId, $or: [{ phoneLast10: phoneKey }] };
  }
  if (emailKey) {
    return { userEmail, folderId, $or: [{ Email: emailKey }, { email: emailKey }] };
  }
  return null;
}
function applyIdentityFields(
  set: Record<string, any>,
  phoneKey?: string,
  emailKey?: string,
  phoneRaw?: any,
  normalizedPhone?: string,
  phoneDigits?: string
) {
  if (phoneRaw !== undefined) set["Phone"] = phoneRaw;
  if (phoneDigits !== undefined) set["phone"] = phoneDigits;
  if (phoneKey !== undefined) {
    set["phoneLast10"] = phoneKey;
  }
  if (normalizedPhone !== undefined) set["normalizedPhone"] = normalizedPhone;
  if (emailKey !== undefined) {
    set["Email"] = emailKey;
    set["email"] = emailKey;
  }
}

const INTERNAL_MAPPED_KEYS = new Set([
  "__createdAtOverride",
  "userEmail",
  "ownerEmail",
  "folderId",
  "rawRow",
  "phone",
  "phoneLast10",
  "normalizedPhone",
  "Email",
  "email",
  "Phone",
  "status",
]);

function applyMappedLeadFields(base: Record<string, any>, mapped: Record<string, any>) {
  for (const [key, value] of Object.entries(mapped)) {
    if (INTERNAL_MAPPED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    base[key] = value;
  }
}

/* ========================= ROUTE HANDLER ========================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });
  const userEmail = lc(session.user.email)!;

  await dbConnect();

  /* ---------- JSON MODE ---------- */
  const json = await readJsonBody(req);
  if (json) {
    try {
      const { targetFolderId, mapping, rows, skipExisting = false, skipHeaders = [] } = json;
      const skippedHeaderSet = buildSkippedHeaderSet(skipHeaders);
      const importRows = rows || [];
      const headers = collectHeaders(importRows);
      const normalizedMapping = normalizeImportMapping(mapping || {}, headers);
      const warnings: string[] = [];
      const responseSummary = {
        mapped: normalizedMapping.mapped,
        customFields: normalizedMapping.customFields,
        skipped: mergeSkippedHeaders(normalizedMapping, skipHeaders),
        warnings,
      };

      const preferredName = (json.newFolderName || json.newFolder || json.name || "")
        .toString()
        .trim();
      const fallbackSelected = (json.folderName || "").toString().trim();
      const resolvedFolderName = preferredName || fallbackSelected || undefined;

      if (!mapping || !rows || !Array.isArray(rows)) {
        return res.status(400).json({ message: "Missing mapping or rows[]" });
      }
      if (!targetFolderId && !resolvedFolderName) {
        return res
          .status(400)
          .json({ message: "Choose an existing folder or provide a new folder name." });
      }

      const { folder } = await selectImportFolder(userEmail, {
        targetFolderId,
        folderName: resolvedFolderName,
      });

      // 🔒 FINAL GUARD (cannot be bypassed)
      const { folderId: safeFolderId, folderName: safeFolderName } =
        await ensureNonSystemFolderId(
          userEmail,
          new mongoose.Types.ObjectId((folder as any)._id),
          (folder as any).name
        );

      const mapped: any[] = importRows.map((r, index) => ({
        ...mapRow(r, normalizedMapping, skippedHeaderSet, warnings, index),
        userEmail,
        folderId: safeFolderId,
        rawRow: r,
      }));
      await upsertCustomFieldRegistry(userEmail, normalizedMapping.customFields);

      const phoneKeys = Array.from(
        new Set(mapped.map((m) => m.phoneLast10).filter(Boolean) as string[])
      );
      const normalizedPhoneKeys = Array.from(
        new Set(mapped.map((m) => m.normalizedPhone).filter(Boolean) as string[])
      );
      const emailKeys = Array.from(
        new Set(mapped.map((m) => m.Email).filter(Boolean) as string[])
      );

      const ors: any[] = [];
      if (phoneKeys.length) {
        ors.push({ phoneLast10: { $in: phoneKeys } });
      }
      if (normalizedPhoneKeys.length) {
        ors.push({ normalizedPhone: { $in: normalizedPhoneKeys } });
      }
      if (emailKeys.length) {
        ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });
      }

      const existing = ors.length
        ? await Lead.find({ userEmail, folderId: safeFolderId, $or: ors }).select(
            "_id phone phoneLast10 normalizedPhone Email email folderId status soldAt"
          )
        : [];

      const byPhone = new Map<string, any>();
      const byEmail = new Map<string, any>();
      for (const l of existing) {
        const p1 = l.phoneLast10 && String(l.phoneLast10);
        const p2 = l.normalizedPhone && String(l.normalizedPhone);
        const e1 = l.Email && String(l.Email).toLowerCase();
        const e2 = l.email && String(l.email).toLowerCase();
        if (p1) byPhone.set(p1, l);
        if (p2) byPhone.set(p2, l);
        if (e1) byEmail.set(e1, l);
        if (e2) byEmail.set(e2, l);
      }

      const ops: any[] = [];
      const processedFilters: any[] = [];
      let skipped = 0;

      for (const m of mapped) {
        const phoneKey = m.phoneLast10 as string | undefined;
        const emailKey = (m.Email as string | undefined) || (m.email as string | undefined);
        const normalizedPhoneKey = m.normalizedPhone as string | undefined;
        const exists =
          (phoneKey && byPhone.get(phoneKey)) ||
          (normalizedPhoneKey && byPhone.get(normalizedPhoneKey)) ||
          (emailKey && byEmail.get(String(emailKey)));

        if (!phoneKey && !emailKey) {
          skipped++;
          continue;
        }
        if (skipExisting && exists) {
          skipped++;
          continue;
        }

        const filter = buildFilter(userEmail, safeFolderId, phoneKey, emailKey);
        if (!filter) {
          skipped++;
          continue;
        }

        // $set base (NEVER duplicate fields into $setOnInsert)
        const base: any = {
          ownerEmail: userEmail,
          folderId: safeFolderId,
          folder_name: String(safeFolderName),
          ["Folder Name"]: String(safeFolderName),
          updatedAt: new Date(),
        };
        if ((m as any).rawRow !== undefined) base.rawRow = (m as any).rawRow;


        applyIdentityFields(base, phoneKey, emailKey, (m as any).Phone, (m as any).normalizedPhone, (m as any).phone);
        if (exists?.phone) {
          delete base.phone;
          delete base.phoneLast10;
        }
        if (exists?.normalizedPhone) delete base.normalizedPhone;
        applyMappedLeadFields(base, m);

        if (exists) {
          if (m.status) {
            const now = base.updatedAt as Date;
            base.status = m.status; // EXISTING → status only in $set
            Object.assign(
              base,
              buildSoldAtTransitionSet({
                nextStatus: m.status,
                previousStatus: exists.status,
                existingSoldAt: exists.soldAt,
                now,
              }),
            );
          }
          ops.push({ updateOne: { filter, update: { $set: base }, upsert: false } });
          processedFilters.push(filter);
        } else {
          const createdAt = (m as any).__createdAtOverride || new Date();
          const setOnInsert: any = {
            userEmail,
            status: (m as any).status || "New", // NEW → status only in $setOnInsert
            createdAt,
          };
          if (isSoldStatus(setOnInsert.status)) {
            setOnInsert.soldAt = createdAt;
            setOnInsert.soldAtApproximate = false;
          }
          if ("status" in base) delete base.status;
          ops.push({
            updateOne: {
              filter,
              update: { $set: base, $setOnInsert: setOnInsert },
              upsert: true,
            },
          });
          processedFilters.push(filter);
        }
      }

      let inserted = 0;
      let updated = 0;
      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });

        // ✅ Enroll ONLY brand-new inserted leads into any active drip watchers for this folder.
        // Safety: uses bulkWrite upserted IDs; does NOT run for existing leads/updates.
        try {
          const newIds = getUpsertedIdsFromBulkWrite(result);
          if (newIds.length) {
            await Promise.allSettled(
              newIds.map((leadId) =>
                enrollOnNewLeadIfWatched({
                  userEmail,
                  folderId: String(safeFolderId),
                  leadId: String(leadId),
                  source: "folder-bulk",
                  startMode: "now",
                })
              )
            );
          }
        } catch (e) {
          console.error("[CSV Import] drip enroll failed", e);
        }

        inserted = (result as any).upsertedCount || 0;
        updated = (result as any).modifiedCount || 0;

        if (processedFilters.length) {
          const orFilters = processedFilters.flatMap((f) =>
            (f.$or || []).map((clause: any) => ({ userEmail, ...clause }))
          );
          const affected = await Lead.find({ userEmail, folderId: safeFolderId, $or: orFilters }).select("_id");
          const ids = affected.map((d) => String(d._id));
          if (ids.length) {
            await Folder.updateOne(
              { _id: safeFolderId, userEmail },
              { $addToSet: { leadIds: { $each: ids } } }
            );
          }
        }
      }

      return res.status(200).json({
        message: "Import completed",
        folderId: safeFolderId,
        folderName: safeFolderName,
        counts: { inserted, updated, skipped },
        mode: "json",
        skipExisting,
        ...responseSummary,
      });
    } catch (e: any) {
      const code = e?.status === 400 ? 400 : 500;
      console.error("❌ JSON import error:", { userEmail, error: e?.message || String(e) });
      return res.status(code).json({ message: e?.message || "Import failed" });
    }
  }

  /* ---------- MULTIPART MODE (CSV upload) ---------- */
  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("❌ Form parse error:", err);
      return res.status(500).json({ message: "Form parse error" });
    }
    try {
      const targetFolderId =
        (Array.isArray(fields.targetFolderId)
          ? fields.targetFolderId[0]
          : fields.targetFolderId)?.toString() || undefined;

      // Prefer typed "new" name first; fall back to selected folderName
      const preferredNameRaw =
        (fields as any).newFolderName ?? (fields as any).newFolder ?? (fields as any).name;
      const preferredName =
        (Array.isArray(preferredNameRaw)
          ? preferredNameRaw[0]
          : preferredNameRaw)?.toString()?.trim() || "";
      const selectedNameRaw = fields.folderName;
      const selectedName =
        (Array.isArray(selectedNameRaw)
          ? selectedNameRaw[0]
          : selectedNameRaw)?.toString()?.trim() || "";
      const resolvedFolderName = preferredName || selectedName || undefined;

      if (!targetFolderId && !resolvedFolderName) {
        return res
          .status(400)
          .json({ message: "Choose an existing folder or provide a new folder name." });
      }

      const mappingStr = (
        Array.isArray(fields.mapping) ? fields.mapping[0] : fields.mapping
      )?.toString();
      const skipHeadersStr = (
        Array.isArray((fields as any).skipHeaders)
          ? (fields as any).skipHeaders[0]
          : (fields as any).skipHeaders
      )?.toString();
      const skipHeaders = skipHeadersStr ? JSON.parse(skipHeadersStr) : [];
      const skippedHeaderSet = buildSkippedHeaderSet(skipHeaders);
      const skipExisting =
        (
          Array.isArray(fields.skipExisting)
            ? fields.skipExisting[0]
            : fields.skipExisting
        )?.toString() === "true";

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file?.filepath) return res.status(400).json({ message: "Missing file" });

      // Resolve folder selection
      const { folder } = await selectImportFolder(userEmail, {
        targetFolderId,
        folderName: resolvedFolderName,
      });

      // 🔒 FINAL GUARD (cannot be bypassed)
      const { folderId: safeFolderId, folderName: safeFolderName } =
        await ensureNonSystemFolderId(
          userEmail,
          new mongoose.Types.ObjectId((folder as any)._id),
          (folder as any).name
        );

      // Legacy CSV path (no mapping)
      if (!mappingStr) {
        const buffer = await fs.promises.readFile(file.filepath);
        const rawLeads: any[] = [];
        await new Promise<void>((resolve, reject) => {
          bufferToStream(buffer)
            .pipe(csvParser())
            .on("data", (row) => {
              const cleaned = Object.entries(row).reduce((acc, [key, val]) => {
                acc[String(key).trim()] =
                  typeof val === "string" ? val.trim() : val;
                return acc;
              }, {} as Record<string, any>);
              rawLeads.push(cleaned);
            })
            .on("end", () => resolve())
            .on("error", (e) => reject(e));
        });

        if (rawLeads.length === 0) {
          return res.status(400).json({
            message: "No data rows found in CSV (empty file or header-only).",
          });
        }

        const leadsToInsert = rawLeads.map((lead) => {
          const rowPhone = extractPhoneFromRow(lead);
          const phoneDigits = rowPhone.phone || String(lead["Phone"] || lead["phone"] || "").replace(/\D+/g, "");
          const phoneKey = phoneDigits ? phoneDigits.slice(-10) : undefined;
          const emailKey = lcEmail(lead["Email"] || lead["email"]);
          return withDerivedTimezone({
            ...lead,
            rawRow: lead,
            userEmail,
            folderId: safeFolderId,
            folder_name: String(safeFolderName),
            ["Folder Name"]: String(safeFolderName),
            status: "New",
            Phone: lead["Phone"] ?? lead["phone"],
            phone: phoneDigits || undefined,
            phoneLast10: phoneKey,
            normalizedPhone: rowPhone.normalizedPhone || normalizePhoneDigitsToE164(phoneDigits) || undefined,
            Email: emailKey,
            email: emailKey,
            leadType: sanitizeLeadType(lead["Lead Type"] || ""),
          });
        });

        await createLeadsFromCSV(leadsToInsert, userEmail, String(safeFolderId));

        return res.status(200).json({
          message: "Leads imported successfully",
          count: leadsToInsert.length,
          folderId: safeFolderId,
          folderName: safeFolderName,
          mode: "multipart-legacy",
        });
      }

      // New path (mapping provided)
      const mapping = JSON.parse(mappingStr) as Record<string, string>;

      const buffer = await fs.promises.readFile(file.filepath);
      const rawRows: any[] = [];
      await new Promise<void>((resolve, reject) => {
        bufferToStream(buffer)
          .pipe(csvParser())
          .on("data", (row) => {
            const cleaned = Object.entries(row).reduce((acc, [key, val]) => {
              acc[String(key).trim()] =
                typeof val === "string" ? val.trim() : val;
              return acc;
            }, {} as Record<string, any>);
            rawRows.push(cleaned);
          })
          .on("end", () => resolve())
          .on("error", (e) => reject(e));
      });

      if (rawRows.length === 0) {
        return res.status(400).json({
          message: "No data rows found in CSV (empty file or header-only).",
        });
      }

      const headers = collectHeaders(rawRows);
      const normalizedMapping = normalizeImportMapping(mapping, headers);
      const warnings: string[] = [];
      const responseSummary = {
        mapped: normalizedMapping.mapped,
        customFields: normalizedMapping.customFields,
        skipped: mergeSkippedHeaders(normalizedMapping, skipHeaders),
        warnings,
      };

      const rowsMapped: any[] = rawRows.map((r, index) => ({
        ...mapRow(r, normalizedMapping, skippedHeaderSet, warnings, index),
        userEmail,
        folderId: safeFolderId,
        rawRow: r,
      }));
      await upsertCustomFieldRegistry(userEmail, normalizedMapping.customFields);

      const phoneKeys = Array.from(
        new Set(rowsMapped.map((m) => m.phoneLast10).filter(Boolean) as string[])
      );
      const normalizedPhoneKeys = Array.from(
        new Set(rowsMapped.map((m) => m.normalizedPhone).filter(Boolean) as string[])
      );
      const emailKeys = Array.from(
        new Set(rowsMapped.map((m) => m.Email).filter(Boolean) as string[])
      );

      const ors: any[] = [];
      if (phoneKeys.length) {
        ors.push({ phoneLast10: { $in: phoneKeys } });
      }
      if (normalizedPhoneKeys.length) {
        ors.push({ normalizedPhone: { $in: normalizedPhoneKeys } });
      }
      if (emailKeys.length) {
        ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });
      }

      const existing = ors.length
        ? await Lead.find({ userEmail, folderId: safeFolderId, $or: ors }).select(
            "_id phone phoneLast10 normalizedPhone Email email folderId status soldAt"
          )
        : [];

      const byPhone = new Map<string, any>();
      const byEmail = new Map<string, any>();
      for (const l of existing) {
        const p1 = l.phoneLast10 && String(l.phoneLast10);
        const p2 = l.normalizedPhone && String(l.normalizedPhone);
        const e1 = l.Email && String(l.Email).toLowerCase();
        const e2 = l.email && String(l.email).toLowerCase();
        if (p1) byPhone.set(p1, l);
        if (p2) byPhone.set(p2, l);
        if (e1) byEmail.set(e1, l);
        if (e2) byEmail.set(e2, l);
      }

      const ops: any[] = [];
      const processedFilters: any[] = [];
      let skipped = 0;

      for (const m of rowsMapped) {
        const phoneKey = m.phoneLast10 as string | undefined;
        const emailKey = (m.Email as string | undefined) || (m.email as string | undefined);
        const normalizedPhoneKey = m.normalizedPhone as string | undefined;
        const exists =
          (phoneKey && byPhone.get(phoneKey)) ||
          (normalizedPhoneKey && byPhone.get(normalizedPhoneKey)) ||
          (emailKey && byEmail.get(String(emailKey)));

        if (!phoneKey && !emailKey) {
          skipped++;
          continue;
        }
        if ((skipExisting as boolean) && exists) {
          skipped++;
          continue;
        }

        const filter = buildFilter(userEmail, safeFolderId, phoneKey, emailKey);
        if (!filter) {
          skipped++;
          continue;
        }

        const base: any = {
          ownerEmail: userEmail,
          folderId: safeFolderId,
          folder_name: String(safeFolderName),
          ["Folder Name"]: String(safeFolderName),
          updatedAt: new Date(),
        };
        applyIdentityFields(base, phoneKey, emailKey, (m as any).Phone, (m as any).normalizedPhone, (m as any).phone);
        if (exists?.phone) {
          delete base.phone;
          delete base.phoneLast10;
        }
        if (exists?.normalizedPhone) delete base.normalizedPhone;
        applyMappedLeadFields(base, m);

        if (exists) {
          if (m.status) {
            const now = base.updatedAt as Date;
            base.status = m.status;
            Object.assign(
              base,
              buildSoldAtTransitionSet({
                nextStatus: m.status,
                previousStatus: exists.status,
                existingSoldAt: exists.soldAt,
                now,
              }),
            );
          }
          ops.push({ updateOne: { filter, update: { $set: base }, upsert: false } });
          processedFilters.push(filter);
        } else {
          const createdAt = (m as any).__createdAtOverride || new Date();
          const setOnInsert: any = {
            userEmail,
            status: (m as any).status || "New",
            createdAt,
          };
          if (isSoldStatus(setOnInsert.status)) {
            setOnInsert.soldAt = createdAt;
            setOnInsert.soldAtApproximate = false;
          }
          if ((m as any).rawRow !== undefined) setOnInsert.rawRow = (m as any).rawRow;

          if ("status" in base) delete base.status;
          ops.push({
            updateOne: {
              filter,
              update: { $set: base, $setOnInsert: setOnInsert },
              upsert: true,
            },
          });
          processedFilters.push(filter);
        }
      }

      let inserted = 0;
      let updated = 0;
      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });

        // ✅ Enroll ONLY brand-new inserted leads into any active drip watchers for this folder.
        // Safety: uses bulkWrite upserted IDs; does NOT run for existing leads/updates.
        try {
          const newIds = getUpsertedIdsFromBulkWrite(result);
          if (newIds.length) {
            await Promise.allSettled(
              newIds.map((leadId) =>
                enrollOnNewLeadIfWatched({
                  userEmail,
                  folderId: String(safeFolderId),
                  leadId: String(leadId),
                  source: "folder-bulk",
                  startMode: "now",
                })
              )
            );
          }
        } catch (e) {
          console.error("[CSV Import] drip enroll failed", e);
        }

        inserted = (result as any).upsertedCount || 0;
        updated = (result as any).modifiedCount || 0;

        const orFilters = processedFilters.flatMap((f) =>
          (f.$or || []).map((clause: any) => ({ userEmail, ...clause }))
        );
        const affected = await Lead.find({ userEmail, folderId: safeFolderId, $or: orFilters }).select("_id");
        const ids = affected.map((d) => String(d._id));
        if (ids.length) {
          await Folder.updateOne(
            { _id: safeFolderId, userEmail },
            { $addToSet: { leadIds: { $each: ids } } }
          );
        }
      }

      return res.status(200).json({
        message: "Leads imported successfully",
        folderId: safeFolderId,
        folderName: safeFolderName,
        counts: { inserted, updated, skipped },
        mode: "multipart+mapping",
        skipExisting,
        ...responseSummary,
      });
    } catch (e: any) {
      const status = e?.status === 400 ? 400 : 500;
      console.error("❌ Multipart import error:", { error: e?.message || String(e) });
      return res.status(status).json({ message: e?.message || "Import failed" });
    }
  });
}

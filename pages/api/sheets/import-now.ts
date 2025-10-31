// pages/api/sheets/import-now.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import formidable from "formidable";
import fs from "fs";
import csvParser from "csv-parser";
import { Readable } from "stream";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { authOptions } from "../auth/[...nextauth]";
import { sanitizeLeadType, createLeadsFromCSV } from "@/lib/mongo/leads";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

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
  AL: "AL", ALABAMA: "AL", AK: "AK", ALASKA: "AK", AZ: "AZ", ARIZONA: "AZ",
  AR: "AR", ARKANSAS: "AR", CA: "CA", CALIFORNIA: "CA", CO: "CO", COLORADO: "CO",
  CT: "CT", CONNECTICUT: "CT", DE: "DE", DELAWARE: "DE", FL: "FL", FLORIDA: "FL",
  GA: "GA", GEORGIA: "GA", HI: "HI", HAWAII: "HI", ID: "ID", IDAHO: "ID",
  IL: "IL", ILLINOIS: "IL", IN: "IN", INDIANA: "IN", IA: "IA", IOWA: "IA",
  KS: "KS", KANSAS: "KS", KY: "KY", KENTUCKY: "KY", LA: "LA", LOUISIANA: "LA",
  ME: "ME", MAINE: "ME", MD: "MD", MARYLAND: "MD", MA: "MA", MASSACHUSETTS: "MA",
  MI: "MI", MICHIGAN: "MI", MN: "MN", MINNESOTA: "MN", MS: "MS", MISSISSIPPI: "MS",
  MO: "MO", MISSOURI: "MO", MT: "MT", MONTANA: "MT", NE: "NE", NEBRASKA: "NE",
  NV: "NV", NEVADA: "NV", NH: "NH", NEW_HAMPSHIRE: "NH", "NEW HAMPSHIRE": "NH",
  NJ: "NJ", NEW_JERSEY: "NJ", "NEW JERSEY": "NJ", NM: "NM", NEW_MEXICO: "NM",
  "NEW MEXICO": "NM", NY: "NY", NEW_YORK: "NY", "NEW YORK": "NY", NC: "NC",
  NORTH_CAROLINA: "NC", "NORTH CAROLINA": "NC", ND: "ND", NORTH_DAKOTA: "ND",
  "NORTH DAKOTA": "ND", OH: "OH", OHIO: "OH", OK: "OK", OKLAHOMA: "OK",
  OR: "OR", OREGON: "OR", PA: "PA", PENNSYLVANIA: "PA", RI: "RI",
  RHODE_ISLAND: "RI", "RHODE ISLAND": "RI", SC: "SC", SOUTH_CAROLINA: "SC",
  "SOUTH CAROLINA": "SC", SD: "SD", SOUTH_DAKOTA: "SD", "SOUTH DAKOTA": "SD",
  TN: "TN", TENNESSEE: "TN", TX: "TX", TEXAS: "TX", UT: "UT", UTAH: "UT",
  VT: "VT", VERMONT: "VT", VA: "VA", VIRGINIA: "VA", WA: "WA", WASHINGTON: "WA",
  WV: "WV", WEST_VIRGINIA: "WV", "WEST VIRGINIA": "WV", WI: "WI",
  WISCONSIN: "WI", WY: "WY", WYOMING: "WY", DC: "DC",
  "DISTRICT OF COLUMBIA": "DC", DISTRICT_OF_COLUMBIA: "DC",
};
function normalizeState(input?: string | null): string | undefined {
  if (!input) return undefined;
  const key = String(input).trim().toUpperCase();
  return STATE_MAP[key] || STATE_MAP[key.replace(/\s+/g, "_")] || undefined;
}
function sanitizeStatus(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  return s.toLowerCase().split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/* ------------------------------------------------------------------ */
/*  NEW-FOLDER-ONLY resolver (NO throws for system)                   */
/* ------------------------------------------------------------------ */
function makeSafeName(sourceHint?: string, requested?: string) {
  const base =
    (sourceHint && String(sourceHint).trim()) ||
    (requested && String(requested).trim()) ||
    `Google Sheet — ${new Date().toISOString().slice(0, 10)}`;
  const cleaned = base.replace(/\s+/g, " ").trim();
  return isSystemFolder(cleaned) ? `Google Sheet — ${cleaned}` : cleaned;
}

async function selectImportFolder(
  userEmail: string,
  opts: { folderName?: string; sourceHint?: string }
) {
  const safeName = makeSafeName(opts.sourceHint, opts.folderName);
  const folder = await Folder.findOneAndUpdate(
    { userEmail, name: safeName },
    { $setOnInsert: { userEmail, name: safeName } },
    { new: true, upsert: true }
  );
  return { folder, safeName };
}

/* ---- JSON body reader ---- */
type JsonPayload = {
  folderName?: string;
  newFolderName?: string;
  newFolder?: string;
  name?: string;
  mapping?: Record<string, string>;
  rows?: Record<string, any>[];
  skipExisting?: boolean;
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
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return {}; }
}

/* ---- CSV mapping ---- */
function mapRow(row: Record<string, any>, mapping: Record<string, string>) {
  const pick = (k: string) => {
    const col = mapping[k];
    if (!col) return undefined;
    const v = row[col];
    return typeof v === "string" ? v.trim() : v;
  };

  const first = pick("firstName");
  const last = pick("lastName");
  const email = pick("email");
  const phone = pick("phone");
  const stateRaw = pick("state");
  const notes = pick("notes");
  const source = pick("source");
  const leadTypeRaw = row["Lead Type"] || row["leadType"] || row["LeadType"];
  const statusRaw = pick("status") ?? pick("disposition");

  const mergedNotes =
    source && notes ? `${notes} | Source: ${source}` :
    source && !notes ? `Source: ${source}` :
    notes;

  const normalizedState = normalizeState(stateRaw);
  const emailLc = lcEmail(email);
  const phoneKey = last10(phone);
  const status = sanitizeStatus(statusRaw) || "New";

  return {
    "First Name": first,
    "Last Name": last,
    Email: emailLc,
    email: emailLc,
    Phone: phone,
    phoneLast10: phoneKey,
    normalizedPhone: phoneKey,
    State: normalizedState,
    Notes: mergedNotes,
    leadType: sanitizeLeadType(leadTypeRaw || ""),
    status,
  };
}

/* ---- dedupe helpers ---- */
function buildFilter(userEmail: string, phoneKey?: string, emailKey?: string) {
  if (phoneKey) return { userEmail, $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] };
  if (emailKey) return { userEmail, $or: [{ Email: emailKey }, { email: emailKey }] };
  return null;
}
function applyIdentityFields(set: Record<string, any>, phoneKey?: string, emailKey?: string, phoneRaw?: any) {
  if (phoneRaw !== undefined) set["Phone"] = phoneRaw;
  if (phoneKey !== undefined) { set["phoneLast10"] = phoneKey; set["normalizedPhone"] = phoneKey; }
  if (emailKey !== undefined) { set["Email"] = emailKey; set["email"] = emailKey; }
}

/* =========================  ROUTE HANDLER  ========================= */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as
    | { user?: { email?: string | null } | null }
    | null;

  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = lc(session.user.email)!;
  await dbConnect();

  /* ---------- JSON MODE (NEW FOLDER ONLY) ---------- */
  const json = await readJsonBody(req);
  if (json) {
    try {
      const { mapping, rows, skipExisting = false } = json;
      const providedName = (json.newFolderName || json.newFolder || json.name || json.folderName || "").toString().trim();

      if (!mapping || !rows || !Array.isArray(rows)) {
        return res.status(400).json({ message: "Missing mapping or rows[]" });
      }

      const { folder, safeName } = await selectImportFolder(userEmail, { folderName: providedName });

      const mapped = rows.map((r) => ({ ...mapRow(r, mapping), userEmail, folderId: folder._id }));

      const phoneKeys = Array.from(new Set(mapped.map((m) => m.phoneLast10).filter(Boolean) as string[]));
      const emailKeys = Array.from(new Set(mapped.map((m) => m.Email).filter(Boolean) as string[]));

      const ors: any[] = [];
      if (phoneKeys.length) ors.push({ phoneLast10: { $in: phoneKeys } }, { normalizedPhone: { $in: phoneKeys } });
      if (emailKeys.length) ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });

      const existing = ors.length
        ? await Lead.find({ userEmail, $or: ors }).select("_id phoneLast10 normalizedPhone Email email folderId")
        : [];

      const byPhone = new Map<string, any>();
      const byEmail = new Map<string, any>(); // ✅ fixed
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
        const exists = (phoneKey && byPhone.get(phoneKey)) || (emailKey && byEmail.get(String(emailKey)));

        if (!phoneKey && !emailKey) { skipped++; continue; }
        if (skipExisting && exists) { skipped++; continue; }

        const filter = buildFilter(userEmail, phoneKey, emailKey);
        if (!filter) { skipped++; continue; }

        const base: any = {
          ownerEmail: userEmail,
          folderId: folder._id,
          folder_name: String(folder.name),
          "Folder Name": String(folder.name),
          updatedAt: new Date(),
        };

        applyIdentityFields(base, phoneKey, emailKey, m.Phone);
        if (m["First Name"] !== undefined) base["First Name"] = m["First Name"];
        if (m["Last Name"] !== undefined) base["Last Name"] = m["Last Name"];
        if (m.State !== undefined) base["State"] = m.State;
        if (m.Notes !== undefined) base["Notes"] = m.Notes;
        if (m.leadType) base["leadType"] = m.leadType;

        if (exists) {
          if (m.status) base.status = m.status; // status only when provided on update
          ops.push({ updateOne: { filter, update: { $set: base }, upsert: false } });
          processedFilters.push(filter);
        } else {
          const setOnInsert: any = {
            userEmail,
            status: m.status || "New",
            createdAt: new Date(),
          };
          if ("status" in base) delete base.status; // avoid $set + $setOnInsert status conflict

          ops.push({ updateOne: { filter, update: { $set: base, $setOnInsert: setOnInsert }, upsert: true } });
          processedFilters.push(filter);
        }
      }

      let inserted = 0;
      let updated = 0;

      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });
        inserted = (result as any).upsertedCount || 0;
        const existedOps = processedFilters.length - inserted;
        updated = existedOps < 0 ? 0 : existedOps;

        if (processedFilters.length) {
          const orFilters = processedFilters.flatMap((f) => (f.$or || []).map((clause: any) => ({ userEmail, ...clause })));
          const affected = await Lead.find({ $or: orFilters }).select("_id");
          const ids = affected.map((d) => String(d._id));
          if (ids.length) {
            await Folder.updateOne({ _id: folder._id, userEmail }, { $addToSet: { leadIds: { $each: ids } } });
          }
        }
      }

      return res.status(200).json({
        message: "Import completed",
        folderId: folder._id,
        folderName: folder.name,
        counts: { inserted, updated, skipped },
        mode: "json-new-folder-only",
        safeName,
        skipExisting,
      });
    } catch (e: any) {
      console.error("❌ JSON import error:", { userEmail, error: e?.message || String(e) });
      return res.status(500).json({ message: "Import failed" });
    }
  }

  /* ---------- MULTIPART MODE (CSV upload, NEW FOLDER ONLY) ---------- */
  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("❌ Form parse error:", err);
      return res.status(500).json({ message: "Form parse error" });
    }

    try {
      const providedNameRaw =
        (fields as any).newFolderName ?? (fields as any).newFolder ?? (fields as any).name ?? fields.folderName;
      const providedName =
        (Array.isArray(providedNameRaw) ? providedNameRaw[0] : providedNameRaw)?.toString()?.trim() || "";

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file?.filepath) return res.status(400).json({ message: "Missing file" });

      const mappingStr = (Array.isArray(fields.mapping) ? fields.mapping[0] : fields.mapping)?.toString();
      const skipExisting =
        (Array.isArray(fields.skipExisting) ? fields.skipExisting[0] : fields.skipExisting)?.toString() === "true";

      const sourceHint = file.originalFilename || providedName;
      const { folder, safeName } = await selectImportFolder(userEmail, {
        folderName: providedName,
        sourceHint,
      });

      const buffer = await fs.promises.readFile(file.filepath);
      const rawRows: any[] = [];

      await new Promise<void>((resolve, reject) => {
        bufferToStream(buffer)
          .pipe(csvParser())
          .on("data", (row) => {
            const cleaned = Object.entries(row).reduce((acc, [key, val]) => {
              acc[String(key).trim()] = typeof val === "string" ? val.trim() : val;
              return acc;
            }, {} as Record<string, any>);
            rawRows.push(cleaned);
          })
          .on("end", () => resolve())
          .on("error", (e) => reject(e));
      });

      if (rawRows.length === 0) {
        return res.status(400).json({ message: "No data rows found in CSV (empty file or header-only)." });
      }

      if (!mappingStr) {
        // Legacy straight-insert (no mapping UI)
        const leadsToInsert = rawRows.map((lead) => {
          const phoneKey = last10(lead["Phone"] || lead["phone"]);
          const emailKey = lcEmail(lead["Email"] || lead["email"]);
          return {
            ...lead,
            userEmail,
            folderId: folder._id,
            folder_name: String(folder.name),
            "Folder Name": String(folder.name),
            status: "New",
            Phone: lead["Phone"] ?? lead["phone"],
            phoneLast10: phoneKey,
            normalizedPhone: phoneKey,
            Email: emailKey,
            email: emailKey,
            leadType: sanitizeLeadType(lead["Lead Type"] || ""),
          };
        });

        await createLeadsFromCSV(leadsToInsert, userEmail, String(folder._id));
        return res.status(200).json({
          message: "Leads imported successfully",
          count: leadsToInsert.length,
          folderId: folder._id,
          folderName: folder.name,
          safeName,
          mode: "multipart-legacy-new-folder-only",
        });
      }

      // Mapping path
      const mapping = JSON.parse(mappingStr) as Record<string, string>;
      const rowsMapped = rawRows.map((r) => ({ ...mapRow(r, mapping), userEmail, folderId: folder._id }));

      const phoneKeys = Array.from(new Set(rowsMapped.map((m) => m.phoneLast10).filter(Boolean) as string[]));
      const emailKeys = Array.from(new Set(rowsMapped.map((m) => m.Email).filter(Boolean) as string[]));

      const ors: any[] = [];
      if (phoneKeys.length) ors.push({ phoneLast10: { $in: phoneKeys } }, { normalizedPhone: { $in: phoneKeys } });
      if (emailKeys.length) ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });

      const existing = ors.length
        ? await Lead.find({ userEmail, $or: ors }).select("_id phoneLast10 normalizedPhone Email email folderId")
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
        const exists = (phoneKey && byPhone.get(phoneKey)) || (emailKey && byEmail.get(String(emailKey)));

        if (!phoneKey && !emailKey) { skipped++; continue; }
        if (skipExisting && exists) { skipped++; continue; }

        const filter = buildFilter(userEmail, phoneKey, emailKey);
        if (!filter) { skipped++; continue; }

        const base: any = {
          ownerEmail: userEmail,
          folderId: folder._id,
          folder_name: String(folder.name),
          "Folder Name": String(folder.name),
          updatedAt: new Date(),
        };

        applyIdentityFields(base, phoneKey, emailKey, m.Phone);
        if (m["First Name"] !== undefined) base["First Name"] = m["First Name"];
        if (m["Last Name"] !== undefined) base["Last Name"] = m["Last Name"];
        if (m.State !== undefined) base["State"] = m.State;
        if (m.Notes !== undefined) base["Notes"] = m.Notes;
        if (m.leadType) base["leadType"] = m.leadType;

        if (exists) {
          if (m.status) base.status = m.status; // update status only when explicitly provided
          ops.push({ updateOne: { filter, update: { $set: base }, upsert: false } });
          processedFilters.push(filter);
        } else {
          const setOnInsert: any = {
            userEmail,
            status: m.status || "New",
            createdAt: new Date(),
          };
          if ("status" in base) delete base.status;

          ops.push({ updateOne: { filter, update: { $set: base, $setOnInsert: setOnInsert }, upsert: true } });
          processedFilters.push(filter);
        }
      }

      let inserted = 0;
      let updated = 0;

      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });
        inserted = (result as any).upsertedCount || 0;
        const existedOps = processedFilters.length - inserted;
        updated = existedOps < 0 ? 0 : existedOps;

        const orFilters = processedFilters.flatMap((f) => (f.$or || []).map((clause: any) => ({ userEmail, ...clause })));
        const affected = await Lead.find({ $or: orFilters }).select("_id");
        const ids = affected.map((d) => String(d._id));
        if (ids.length) {
          await Folder.updateOne({ _id: folder._id, userEmail }, { $addToSet: { leadIds: { $each: ids } } });
        }
      }

      return res.status(200).json({
        message: "Leads imported successfully",
        folderId: folder._id,
        folderName: folder.name,
        counts: { inserted, updated, skipped },
        mode: "multipart+mapping-new-folder-only",
        safeName,
        skipExisting,
      });
    } catch (e: any) {
      console.error("❌ Multipart import error:", { error: e?.message || String(e) });
      return res.status(500).json({ message: "Import failed" });
    }
  });
}

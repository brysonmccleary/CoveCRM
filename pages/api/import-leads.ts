// pages/api/import-leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import mongoose from "mongoose";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";
import formidable from "formidable";
import fs from "fs";
import csvParser from "csv-parser";
import { Readable } from "stream";

export const config = { api: { bodyParser: false } };

const FINGERPRINT = "selfheal-v5h+plain-import";

const lc = (s?: string | null) => (s ? String(s).trim().toLowerCase() : "");
const digits = (s?: string | null) => (s ? String(s).replace(/\D+/g, "") : "");
const last10 = (s?: string | null) => {
  const d = digits(s);
  return d ? d.slice(-10) : "";
};

function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

/* ---- State normalization (same as CSV route) ---- */
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

/* ---- mapping helpers ---- */
function lcEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  const s = String(email).trim().toLowerCase();
  return s || undefined;
}

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

  const mergedNotes =
    source && notes
      ? `${notes} | Source: ${source}`
      : source && !notes
      ? `Source: ${source}`
      : notes;

  const normalizedState = normalizeState(stateRaw);
  const emailLc = lcEmail(email);
  const phoneKey = last10(phone);

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
    leadType: leadTypeRaw ? String(leadTypeRaw).trim() : undefined,
    // status intentionally omitted
  };
}

/* ---- folder selection (block system names & IDs) ---- */
async function selectImportFolder(
  userEmail: string,
  opts: { targetFolderId?: string; folderName?: string }
) {
  const byName = (opts.folderName || "").trim();

  if (byName) {
    if (isSystemFolder(byName)) {
      const msg = "Cannot import into system folders";
      throw Object.assign(new Error(msg), { status: 400 });
    }
    const f = await Folder.findOneAndUpdate(
      { userEmail, name: byName },
      { $setOnInsert: { userEmail, name: byName, source: "manual-import" } },
      { new: true, upsert: true }
    );
    return { folder: f };
  }

  if (opts.targetFolderId) {
    const f = await Folder.findOne({ _id: opts.targetFolderId, userEmail });
    if (!f) throw Object.assign(new Error("Folder not found or not owned by user"), { status: 400 });
    if (isSystemFolder(f.name)) throw Object.assign(new Error("Cannot import into system folders"), { status: 400 });
    return { folder: f };
  }

  throw Object.assign(
    new Error("A folder is required: provide folderName (creates if missing) or targetFolderId."),
    { status: 400 }
  );
}

/* ---- shared upsert logic ---- */
function buildFilter(userEmail: string, phoneKey?: string, emailKey?: string) {
  if (phoneKey) return { userEmail, $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] };
  if (emailKey) return { userEmail, $or: [{ Email: emailKey }, { email: emailKey }] };
  return null;
}
function applyIdentityFields(
  set: Record<string, any>,
  phoneKey?: string,
  emailKey?: string,
  phoneRaw?: any
) {
  if (phoneRaw !== undefined) set["Phone"] = phoneRaw;
  if (phoneKey !== undefined) {
    set["phoneLast10"] = phoneKey;
    set["normalizedPhone"] = phoneKey;
  }
  if (emailKey !== undefined) {
    set["Email"] = emailKey;
    set["email"] = emailKey;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = lc(session.user.email)!;
  await dbConnect();

  const contentType = String(req.headers["content-type"] || "");
  const isJson = contentType.includes("application/json");
  const isMultipart = contentType.startsWith("multipart/form-data");

  try {
    /* ===================== JSON MODE ===================== */
    if (isJson) {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        req.on("data", (c) => chunks.push(Buffer.from(c)));
        req.on("end", () => resolve());
        req.on("error", (e) => reject(e));
      });
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const rows: Array<Record<string, any>> = Array.isArray(body.rows) ? body.rows : [];
      const targetFolderId: string | undefined = typeof body.targetFolderId === "string" ? body.targetFolderId : undefined;
      const folderName: string | undefined = typeof body.folderName === "string" ? body.folderName : undefined;

      if (!rows.length) return res.status(400).json({ message: "rows[] required" });

      const { folder } = await selectImportFolder(userEmail, { targetFolderId, folderName });

      const ops: any[] = [];
      let skippedNoKey = 0;

      for (const raw of rows) {
        const email = lc(raw.email ?? raw.Email);
        const phone10 = last10(raw.phone ?? raw.Phone);
        if (!email && !phone10) { skippedNoKey++; continue; }

        const filter: any = { userEmail };
        const or: any[] = [];
        if (email) or.push({ email }, { Email: email });
        if (phone10) or.push({ normalizedPhone: phone10 }, { phoneLast10: phone10 });
        if (or.length) filter.$or = or;

        const set: Record<string, any> = {
          ownerEmail: userEmail,
          folderId: folder._id,
          folder_name: String(folder.name),
          ["Folder Name"]: String(folder.name),
          updatedAt: new Date(),
        };

        // Copy standard fields; NEVER touch status/disposition from input
        const copyIf = (kIn: string, kOut: string = kIn) => {
          if (raw[kIn] !== undefined && raw[kIn] !== null && String(raw[kIn]).trim() !== "") {
            set[kOut] = raw[kIn];
          }
        };
        copyIf("First Name");
        copyIf("Last Name");
        copyIf("firstName", "First Name");
        copyIf("lastName", "Last Name");
        copyIf("State");
        copyIf("state", "State");
        copyIf("Notes");
        copyIf("notes", "Notes");
        copyIf("leadType");

        if (email) { set["email"] = email; set["Email"] = email; }
        if (phone10) {
          set["normalizedPhone"] = phone10;
          set["phoneLast10"] = phone10;
          set["Phone"] = raw.Phone ?? raw.phone ?? phone10;
        }

        ops.push({
          updateOne: {
            filter,
            update: {
              $set: set,
              $setOnInsert: { userEmail, status: "New", createdAt: new Date() },
            },
            upsert: true,
          },
        });
      }

      let inserted = 0, updated = 0;
      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });
        const upserts = (result as any).upsertedCount || 0;
        const total = ops.length;
        inserted = upserts;
        updated = Math.max(0, total - upserts - skippedNoKey);

        // Attach to folder leadIds
        const affected = await Lead.find({
          userEmail,
          $or: [
            { folderId: folder._id }, // broad, safe
          ],
        }).select("_id");
        const ids = affected.map((d) => String(d._id));
        if (ids.length) {
          await Folder.updateOne(
            { _id: folder._id, userEmail },
            { $addToSet: { leadIds: { $each: ids } } }
          );
        }
      }

      return res.status(200).json({
        ok: true,
        fingerprint: FINGERPRINT,
        folderId: String(folder._id),
        folderName: String(folder.name),
        counts: { inserted, updated, skippedNoKey, attempted: rows.length },
        mode: "json",
      });
    }

    /* ================== MULTIPART (CSV) MODE ================== */
    if (isMultipart) {
      const form = formidable({ multiples: false });
      return form.parse(req, async (err, fields, files) => {
        if (err) {
          console.error("❌ Form parse error:", err);
          return res.status(500).json({ message: "Form parse error" });
        }

        try {
          const targetFolderId =
            (Array.isArray(fields.targetFolderId) ? fields.targetFolderId[0] : fields.targetFolderId)?.toString() || undefined;

          const preferredNameRaw =
            (fields as any).newFolderName ?? (fields as any).newFolder ?? (fields as any).name;
          const preferredName =
            (Array.isArray(preferredNameRaw) ? preferredNameRaw[0] : preferredNameRaw)?.toString()?.trim() || "";

          const selectedNameRaw = fields.folderName;
          const selectedName =
            (Array.isArray(selectedNameRaw) ? selectedNameRaw[0] : selectedNameRaw)?.toString()?.trim() || "";

          const resolvedFolderName = preferredName || selectedName || undefined;

          if (!targetFolderId && !resolvedFolderName) {
            return res.status(400).json({ message: "Choose an existing folder or provide a new folder name." });
          }

          const mappingStr =
            (Array.isArray(fields.mapping) ? fields.mapping[0] : fields.mapping)?.toString();
          if (!mappingStr) {
            return res.status(400).json({ message: "mapping is required for CSV import" });
          }
          const mapping = JSON.parse(mappingStr) as Record<string, string>;

          const skipExisting =
            (Array.isArray(fields.skipExisting) ? fields.skipExisting[0] : fields.skipExisting)?.toString() === "true";

          const file = Array.isArray(files.file) ? files.file[0] : files.file;
          if (!file?.filepath) return res.status(400).json({ message: "Missing file" });

          const { folder } = await selectImportFolder(userEmail, { targetFolderId, folderName: resolvedFolderName });

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

          if (!rawRows.length) {
            return res.status(400).json({ message: "No data rows found in CSV (empty file or header-only)." });
          }

          const rowsMapped = rawRows.map((r) => ({
            ...mapRow(r, mapping),
            userEmail,
            folderId: folder._id,
          }));

          const phoneKeys = Array.from(new Set(rowsMapped.map((m) => m.phoneLast10).filter(Boolean) as string[]));
          const emailKeys = Array.from(new Set(rowsMapped.map((m) => m.Email).filter(Boolean) as string[]));

          const ors: any[] = [];
          if (phoneKeys.length) {
            ors.push({ phoneLast10: { $in: phoneKeys } }, { normalizedPhone: { $in: phoneKeys } });
          }
          if (emailKeys.length) {
            ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });
          }

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
              ops.push({ updateOne: { filter, update: { $set: base }, upsert: false } });
              processedFilters.push(filter);
            } else {
              const setOnInsert: any = {
                userEmail,
                status: "New", // only on insert
                createdAt: new Date(),
              };
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

          let inserted = 0, updated = 0;
          if (ops.length) {
            const result = await (Lead as any).bulkWrite(ops, { ordered: false });
            inserted = (result as any).upsertedCount || 0;
            const existedOps = processedFilters.length - inserted;
            updated = existedOps < 0 ? 0 : existedOps;

            if (processedFilters.length) {
              const orFilters = processedFilters.flatMap((f) =>
                (f.$or || []).map((clause: any) => ({ userEmail, ...clause }))
              );
              const affected = await Lead.find({ $or: orFilters }).select("_id");
              const ids = affected.map((d) => String(d._id));
              if (ids.length) {
                await Folder.updateOne(
                  { _id: folder._id, userEmail },
                  { $addToSet: { leadIds: { $each: ids } } }
                );
              }
            }
          }

          return res.status(200).json({
            ok: true,
            fingerprint: FINGERPRINT,
            folderId: String(folder._id),
            folderName: String(folder.name),
            counts: { inserted, updated, skipped },
            mode: "multipart+mapping",
            skipExisting,
          });
        } catch (e: any) {
          const status = e?.status === 400 ? 400 : 500;
          console.error("❌ multipart import-leads error:", e?.message || e);
          return res.status(status).json({ message: e?.message || "Import failed" });
        }
      });
    }

    // If neither JSON nor multipart, reject clearly
    return res.status(400).json({ message: "Unsupported content type. Use JSON (rows[]) or multipart/form-data with file+mapping." });
  } catch (err: any) {
    console.error("import-leads error:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Import failed", fingerprint: FINGERPRINT });
  }
}

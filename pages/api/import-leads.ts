// /pages/api/import-leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "fs";
import csvParser from "csv-parser";
import { Readable } from "stream";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { sanitizeLeadType, createLeadsFromCSV } from "@/lib/mongo/leads";

export const config = { api: { bodyParser: false } };

// ---------- helpers
function bufferToStream(buffer: Buffer): Readable {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

function last10(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const digits = String(phone).replace(/\D+/g, "");
  if (!digits) return undefined;
  const k = digits.slice(-10);
  return k || undefined;
}
function lcEmail(email?: string | null): string | undefined {
  if (!email) return undefined;
  const s = String(email).trim().toLowerCase();
  return s || undefined;
}

// For state normalization (unchanged)
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
function lc(str?: string | null) {
  return str ? String(str).trim().toLowerCase() : undefined;
}

type JsonPayload = {
  targetFolderId?: string;
  folderName?: string; // backward compat
  mapping?: Record<string, string>;
  rows?: Record<string, any>[];
  skipExisting?: boolean; // default false here = MOVE + RESET
};

// Read raw JSON when bodyParser is disabled
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

async function ensureFolder({
  userEmail,
  targetFolderId,
  folderName,
}: {
  userEmail: string;
  targetFolderId?: string;
  folderName?: string;
}) {
  if (targetFolderId) {
    const f = await Folder.findOne({ _id: targetFolderId, userEmail });
    if (!f) throw new Error("Folder not found or not owned by user");
    return f;
  }
  if (!folderName) throw new Error("Missing targetFolderId or folderName");
  let f = await Folder.findOne({ name: folderName, userEmail });
  if (!f) f = await Folder.create({ name: folderName, userEmail });
  return f;
}

// Map one CSV row using provided mapping
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
    leadType: sanitizeLeadType(leadTypeRaw || ""),
  };
}

// ---- Common helpers to build filters and sets with all dedupe fields ----
function buildFilter(userEmail: string, phoneKey?: string, emailKey?: string) {
  if (phoneKey) {
    return {
      userEmail,
      $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }],
    };
  }
  if (emailKey) {
    return {
      userEmail,
      $or: [{ Email: emailKey }, { email: emailKey }],
    };
  }
  return null;
}
function applyIdentityFields(set: Record<string, any>, phoneKey?: string, emailKey?: string, phoneRaw?: any) {
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

  // ---------- JSON MODE ----------
  const json = await readJsonBody(req);
  if (json) {
    try {
      const {
        targetFolderId,
        folderName,
        mapping,
        rows,
        skipExisting = false,
      } = json;
      if (!mapping || !rows || !Array.isArray(rows)) {
        return res.status(400).json({ message: "Missing mapping or rows[]" });
      }

      const folder = await ensureFolder({ userEmail, targetFolderId, folderName });

      // Map rows → normalized leads
      const mapped = rows.map((r) => ({
        ...mapRow(r, mapping),
        userEmail,
        ownerEmail: userEmail,
        folderId: folder._id, // ObjectId enforced by schema
      }));

      // Build dedupe key sets
      const phoneKeys = Array.from(new Set(mapped.map((m) => m.phoneLast10).filter(Boolean) as string[]));
      const emailKeys = Array.from(new Set(mapped.map((m) => m.Email).filter(Boolean) as string[]));

      // Fetch existing across BOTH phone fields and BOTH email fields
      const ors: any[] = [];
      if (phoneKeys.length) {
        ors.push({ phoneLast10: { $in: phoneKeys } });
        ors.push({ normalizedPhone: { $in: phoneKeys } });
      }
      if (emailKeys.length) {
        ors.push({ Email: { $in: emailKeys } });
        ors.push({ email: { $in: emailKeys } });
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

      for (const m of mapped) {
        const phoneKey = m.phoneLast10 as string | undefined;
        const emailKey = (m.Email as string | undefined) || (m.email as string | undefined);

        const exists = (phoneKey && byPhone.get(phoneKey)) || (emailKey && byEmail.get(String(emailKey)));

        if (exists) {
          if (skipExisting) {
            skipped++;
            continue;
          }
          const filter = buildFilter(userEmail, phoneKey, emailKey);
          if (!filter) { skipped++; continue; }

          const set: any = {
            ownerEmail: userEmail,
            folderId: folder._id,
            folder_name: String(folder.name),
            "Folder Name": String(folder.name),
            status: "New",
            updatedAt: new Date(),
          };
          // Keep core fields
          if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
          if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
          if (m.State !== undefined) set["State"] = m.State;
          if (m.Notes !== undefined) set["Notes"] = m.Notes;
          if (m.leadType) set["leadType"] = m.leadType;

          // ✅ Always set identity fields for consistency
          applyIdentityFields(set, phoneKey, emailKey, m.Phone);

          ops.push({ updateOne: { filter, update: { $set: set }, upsert: false } });
          processedFilters.push(filter);
        } else {
          const filter = buildFilter(userEmail, phoneKey, emailKey);
          if (!filter) { skipped++; continue; }

          const setOnInsert: any = {
            userEmail,
            ownerEmail: userEmail,
            status: "New",
            folder_name: String(folder.name),
            "Folder Name": String(folder.name),
            createdAt: new Date(),
          };
          const set: any = { folderId: folder._id, updatedAt: new Date() };

          if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
          if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
          if (m.State !== undefined) set["State"] = m.State;
          if (m.Notes !== undefined) set["Notes"] = m.Notes;
          if (m.leadType) set["leadType"] = m.leadType;

          applyIdentityFields(set, phoneKey, emailKey, m.Phone);
          applyIdentityFields(setOnInsert, phoneKey, emailKey, m.Phone);

          ops.push({ updateOne: { filter, update: { $set: set, $setOnInsert: setOnInsert }, upsert: true } });
          processedFilters.push(filter);
        }
      }

      let inserted = 0;
      let updated = 0;

      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });
        inserted = (result as any).upsertedCount || 0;
        updated = (result as any).modifiedCount || 0;

        if (processedFilters.length) {
          const orFilters = processedFilters.flatMap((f) => (f.$or || []).map((clause: any) => ({ userEmail, ...clause })));
          const affected = await Lead.find({ $or: orFilters }).select("_id");
          const ids = affected.map((d) => String(d._id));
          if (ids.length) {
            await Folder.updateOne({ _id: folder._id, userEmail }, { $addToSet: { leadIds: { $each: ids } } });
          }
        }
      }

      // Fallback per-row upserts if ops ended up empty but we had mappable rows
      if (!ops.length && skipped === 0 && mapped.length > 0) {
        for (const m of mapped) {
          const phoneKey = m.phoneLast10 as string | undefined;
          const emailKey = (m.Email as string | undefined) || (m.email as string | undefined);
          const filter = buildFilter(userEmail, phoneKey, emailKey);
          if (!filter) continue;

          const setOnInsert: any = {
            userEmail,
            ownerEmail: userEmail,
            status: "New",
            folder_name: String(folder.name),
            "Folder Name": String(folder.name),
            createdAt: new Date(),
          };
          const set: any = { folderId: folder._id, updatedAt: new Date() };

          if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
          if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
          if (m.State !== undefined) set["State"] = m.State;
          if (m.Notes !== undefined) set["Notes"] = m.Notes;
          if (m.leadType) set["leadType"] = m.leadType;

          applyIdentityFields(set, phoneKey, emailKey, m.Phone);
          applyIdentityFields(setOnInsert, phoneKey, emailKey, m.Phone);

          const r = await Lead.updateOne(filter, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });
          const upc = (r as any).upsertedCount || ((r as any).upsertedId ? 1 : 0) || 0;
          const mod = (r as any).modifiedCount || 0;
          const match = (r as any).matchedCount || 0;
          if (upc > 0) inserted += upc;
          else if (mod > 0 || match > 0) updated += 1;
        }
      }

      return res.status(200).json({
        message: "Import completed",
        folderId: folder._id,
        folderName: folder.name,
        counts: { inserted, updated, skipped },
        mode: "json",
        skipExisting: false,
      });
    } catch (e: any) {
      console.error("❌ JSON import error:", e);
      return res.status(500).json({ message: "Import failed", error: e?.message || String(e) });
    }
  }

  // ---------- MULTIPART MODE (CSV upload) ----------
  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("❌ Form parse error:", err);
      return res.status(500).json({ message: "Form parse error" });
    }

    const targetFolderId = fields.targetFolderId?.toString();
    const folderNameField = fields.folderName?.toString()?.trim();
    const mappingStr = fields.mapping?.toString();
    const skipExisting = fields.skipExisting?.toString() === "true" ? true : false;

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file?.filepath) return res.status(400).json({ message: "Missing file" });

    // New path (mapping provided)
    if (mappingStr) {
      try {
        const mapping = JSON.parse(mappingStr) as Record<string, string>;
        const folder = await ensureFolder({ userEmail, targetFolderId, folderName: folderNameField });

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

        const rowsMapped = rawRows.map((r) => ({
          ...mapRow(r, mapping),
          userEmail,
          ownerEmail: userEmail,
          folderId: folder._id,
        }));

        const phoneKeys = Array.from(new Set(rowsMapped.map((m) => m.phoneLast10).filter(Boolean) as string[]));
        const emailKeys = Array.from(new Set(rowsMapped.map((m) => m.Email).filter(Boolean) as string[]));

        const ors: any[] = [];
        if (phoneKeys.length) {
          ors.push({ phoneLast10: { $in: phoneKeys } });
          ors.push({ normalizedPhone: { $in: phoneKeys } });
        }
        if (emailKeys.length) {
          ors.push({ Email: { $in: emailKeys } });
          ors.push({ email: { $in: emailKeys } });
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

          if (exists) {
            if (skipExisting) {
              skipped++;
              continue;
            }
            const filter = buildFilter(userEmail, phoneKey, emailKey);
            if (!filter) { skipped++; continue; }

            const set: any = {
              ownerEmail: userEmail,
              folderId: folder._id,
              folder_name: String(folder.name),
              "Folder Name": String(folder.name),
              status: "New",
              updatedAt: new Date(),
            };
            if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
            if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
            if (m.State !== undefined) set["State"] = m.State;
            if (m.Notes !== undefined) set["Notes"] = m.Notes;
            if (m.leadType) set["leadType"] = m.leadType;

            applyIdentityFields(set, phoneKey, emailKey, m.Phone);

            ops.push({ updateOne: { filter, update: { $set: set }, upsert: false } });
            processedFilters.push(filter);
          } else {
            const filter = buildFilter(userEmail, phoneKey, emailKey);
            if (!filter) { skipped++; continue; }

            const setOnInsert: any = {
              userEmail,
              ownerEmail: userEmail,
              status: "New",
              folder_name: String(folder.name),
              "Folder Name": String(folder.name),
              createdAt: new Date(),
            };
            const set: any = { folderId: folder._id, updatedAt: new Date() };

            if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
            if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
            if (m.State !== undefined) set["State"] = m.State;
            if (m.Notes !== undefined) set["Notes"] = m.Notes;
            if (m.leadType) set["leadType"] = m.leadType;

            applyIdentityFields(set, phoneKey, emailKey, m.Phone);
            applyIdentityFields(setOnInsert, phoneKey, emailKey, m.Phone);

            ops.push({ updateOne: { filter, update: { $set: set, $setOnInsert: setOnInsert }, upsert: true } });
            processedFilters.push(filter);
          }
        }

        let inserted = 0;
        let updated = 0;

        if (ops.length) {
          const result = await (Lead as any).bulkWrite(ops, { ordered: false });
          inserted = (result as any).upsertedCount || 0;
          updated = (result as any).modifiedCount || 0;

          const orFilters = processedFilters.flatMap((f) => (f.$or || []).map((clause: any) => ({ userEmail, ...clause })));
          const affected = await Lead.find({ $or: orFilters }).select("_id");
          const ids = affected.map((d) => String(d._id));
          if (ids.length) {
            await Folder.updateOne({ _id: folder._id, userEmail }, { $addToSet: { leadIds: { $each: ids } } });
          }
        }

        // Fallback per-row upserts to guarantee counts
        if (!ops.length && skipped === 0 && rowsMapped.length > 0) {
          for (const m of rowsMapped) {
            const phoneKey = m.phoneLast10 as string | undefined;
            const emailKey = (m.Email as string | undefined) || (m.email as string | undefined);
            const filter = buildFilter(userEmail, phoneKey, emailKey);
            if (!filter) continue;

            const setOnInsert: any = {
              userEmail,
              ownerEmail: userEmail,
              status: "New",
              folder_name: String(folder.name),
              "Folder Name": String(folder.name),
              createdAt: new Date(),
            };
            const set: any = { folderId: folder._id, updatedAt: new Date() };

            if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
            if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
            if (m.State !== undefined) set["State"] = m.State;
            if (m.Notes !== undefined) set["Notes"] = m.Notes;
            if (m.leadType) set["leadType"] = m.leadType;

            applyIdentityFields(set, phoneKey, emailKey, m.Phone);
            applyIdentityFields(setOnInsert, phoneKey, emailKey, m.Phone);

            const r = await Lead.updateOne(filter, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });
            const upc = (r as any).upsertedCount || ((r as any).upsertedId ? 1 : 0) || 0;
            const mod = (r as any).modifiedCount || 0;
            const match = (r as any).matchedCount || 0;
            if (upc > 0) inserted += upc;
            else if (mod > 0 || match > 0) updated += 1;
          }
        }

        return res.status(200).json({
          message: "Leads imported successfully",
          folderId: folder._id,
          folderName: folder.name,
          counts: { inserted, updated, skipped },
          mode: "multipart+mapping",
          skipExisting: false,
        });
      } catch (e: any) {
        console.error("❌ Multipart mapping import error:", e);
        return res.status(500).json({ message: "Import failed", error: e?.message || String(e) });
      }
    }

    // ---------- Legacy path: folderName + CSV (no mapping provided) ----------
    const folderName = folderNameField;
    if (!folderName) return res.status(400).json({ message: "Missing folder name" });

    try {
      const buffer = await fs.promises.readFile(file.filepath);
      const rawLeads: any[] = [];

      await new Promise<void>((resolve, reject) => {
        bufferToStream(buffer)
          .pipe(csvParser())
          .on("data", (row) => {
            const cleaned = Object.entries(row).reduce((acc, [key, val]) => {
              acc[String(key).trim()] = typeof val === "string" ? val.trim() : val;
              return acc;
            }, {} as Record<string, any>);
            rawLeads.push(cleaned);
          })
          .on("end", () => resolve())
          .on("error", (e) => reject(e));
      });

      if (rawLeads.length === 0) {
        return res.status(400).json({ message: "No data rows found in CSV (empty file or header-only)." });
      }

      // Find or create folder (legacy)
      let folder = await Folder.findOne({ name: folderName, userEmail });
      if (!folder) folder = await Folder.create({ name: folderName, userEmail });

      // Normalize identity fields for legacy path too
      const leadsToInsert = rawLeads.map((lead) => {
        const phoneKey = last10(lead["Phone"] || lead["phone"]);
        const emailKey = lcEmail(lead["Email"] || lead["email"]);
        return {
          ...lead,
          userEmail,
          folderId: folder._id, // ObjectId
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
        mode: "multipart-legacy",
      });
    } catch (e: any) {
      console.error("❌ Legacy import error:", e);
      return res.status(500).json({ message: "Insert failed", error: e?.message || String(e) });
    }
  });
}

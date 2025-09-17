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
import {
  SYSTEM_FOLDERS,
  isSystemFolderName,
  isBlockedSystemName,
} from "@/lib/systemFolders";

export const config = { api: { bodyParser: false } };

// ---- trace/fingerprint (appears in every response via X-Import-Tag)
const TRACE =
  `import-leads.ts@${process.env.VERCEL_REGION || "local"}#${(process.env.VERCEL_GIT_COMMIT_SHA || "dev").slice(0,7)}`;
console.warn(`[IMPORT_HANDLER] loaded ${TRACE}`);

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
  NV: "NV", NEVADA: "NV", NH: "NH", NEW_HAMPSHIRE: "NH",
  NJ: "NJ", NEW_JERSEY: "NJ", NM: "NM", NEW_MEXICO: "NM",
  NY: "NY", NEW_YORK: "NY", NC: "NC", NORTH_CAROLINA: "NC",
  ND: "ND", NORTH_DAKOTA: "ND", OH: "OH", OHIO: "OH", OK: "OK", OKLAHOMA: "OK",
  OR: "OR", OREGON: "OR", PA: "PA", PENNSYLVANIA: "PA", RI: "RI", RHODE_ISLAND: "RI",
  SC: "SC", SOUTH_CAROLINA: "SC", SD: "SD", SOUTH_DAKOTA: "SD",
  TN: "TN", TENNESSEE: "TN", TX: "TX", TEXAS: "TX", UT: "UT", UTAH: "UT",
  VT: "VT", VERMONT: "VT", VA: "VA", VIRGINIA: "VA", WA: "WA", WASHINGTON: "WA",
  WV: "WV", WEST_VIRGINIA: "WV", WI: "WI", WISCONSIN: "WI", WY: "WY", WYOMING: "WY",
  DC: "DC", "DISTRICT OF COLUMBIA": "DC", DISTRICT_OF_COLUMBIA: "DC",
};
function normalizeState(input?: string | null): string | undefined {
  if (!input) return undefined;
  const key = String(input).trim().toUpperCase();
  return STATE_MAP[key] || STATE_MAP[key.replace(/\s+/g, "_")] || undefined;
}
function lc(str?: string | null) {
  return str ? String(str).trim().toLowerCase() : undefined;
}
function firstString(v: any): string | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return firstString(v[0]);
  const s = String(v).trim();
  return s ? s : undefined;
}
const truthy = (v: any) =>
  typeof v === "boolean"
    ? v
    : ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());

/** Detect a "create new folder" name from many possible keys (multipart/form fields) */
function detectFolderNameFromForm(fields: Record<string, any>): string | undefined {
  const candidates = [
    "folderName","newFolderName","newFolder","name",
    "new_folder_name","new-folder-name","createFolder","create_folder",
    "createNewFolder","create_new_folder","folder_name",
  ];
  for (const k of candidates) {
    const val = firstString((fields as any)[k]);
    if (val) return val;
  }
  for (const [k, v] of Object.entries(fields)) {
    const key = k.toLowerCase();
    if (key.includes("targetfolderid")) continue;
    if (key.includes("mapping")) continue;
    if (key.includes("skip")) continue;
    if (key.includes("file")) continue;
    if (/new.*folder.*name|folder.*name|create.*folder/.test(key)) {
      const val = firstString(v);
      if (val) return val;
    }
  }
  return undefined;
}

/** Detect a "create new folder" name from many possible keys (JSON) */
function detectFolderNameFromJson(body: Record<string, any>): string | undefined {
  const candidates = [
    "folderName","newFolderName","newFolder","name",
    "new_folder_name","new-folder-name","createFolder","create_folder",
    "createNewFolder","create_new_folder","folder_name",
  ];
  for (const k of candidates) {
    const val = firstString((body as any)[k]);
    if (val) return val;
  }
  for (const [k, v] of Object.entries(body || {})) {
    const key = k.toLowerCase();
    if (key.includes("targetfolderid")) continue;
    if (key.includes("mapping")) continue;
    if (key.includes("rows")) continue;
    if (/new.*folder.*name|folder.*name|create.*folder/.test(key)) {
      const val = firstString(v);
      if (val) return val;
    }
  }
  return undefined;
}

/**
 * Resolve destination folder with strict rules & hard blocking:
 *  - If a non-empty folder *name* is present, it WINS and we IGNORE any targetFolderId.
 *  - Else if targetFolderId is provided, use it (but block system folders by id & name).
 */
async function resolveImportFolder(
  userEmail: string,
  opts: { targetFolderId?: string; folderName?: string }
) {
  const byName = (opts.folderName || "").trim();

  if (byName) {
    if (isSystemFolderName(byName) || isBlockedSystemName(byName)) {
      throw new Error("Cannot import into system folders");
    }
    const f =
      (await Folder.findOne({ userEmail, name: byName })) ||
      (await Folder.create({ userEmail, name: byName }));
    return f;
  }

  if (opts.targetFolderId) {
    const f = await Folder.findOne({ _id: opts.targetFolderId, userEmail });
    if (!f) throw new Error("Folder not found or not owned by user");
    if (isSystemFolderName(f.name) || isBlockedSystemName(f.name)) {
      throw new Error("Cannot import into system folders");
    }
    return f;
  }

  throw new Error("Missing targetFolderId or folderName");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = lc(session.user.email)!;
  await dbConnect();

  // Always tag the response so we know which build handled it
  res.setHeader("X-Import-Tag", TRACE);

  // ---------- JSON MODE ----------
  const readJsonBody = async (): Promise<Record<string, any> | null> => {
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
  };

  const json = await readJsonBody();
  if (json && Object.keys(json).length) {
    try {
      let targetFolderId = firstString((json as any).targetFolderId);
      const mapping = (json as any).mapping as Record<string, string> | undefined;
      const rows = (json as any).rows as Record<string, any>[] | undefined;
      const skipExisting = Boolean((json as any).skipExisting);
      const folderName = detectFolderNameFromJson(json) || undefined;
      const createNew = truthy((json as any).createNewFolder);

      console.log("[IMPORT_JSON] createNew=%s, folderName=%s, targetFolderId=%s",
        createNew, folderName, targetFolderId);

      if (createNew) {
        targetFolderId = undefined;
        if (!folderName || !folderName.trim()) {
          return res.status(400).json({ message: "Missing folder name for new folder" });
        }
      }

      if (!mapping || !rows || !Array.isArray(rows)) {
        return res.status(400).json({ message: "Missing mapping or rows[]" });
      }

      const folder = await resolveImportFolder(userEmail, { targetFolderId, folderName });
      res.setHeader("X-Import-Resolver", folderName ? "name" : (targetFolderId ? "id" : "missing"));
      console.log("[IMPORT_JSON] chosen folder _id=%s name=%s", String(folder._id), folder.name);

      // HARD GUARD (diagnostic): if somehow a system folder sneaks through, trip guard
      if (isSystemFolderName(folder.name) || isBlockedSystemName(folder.name)) {
        res.setHeader("X-Guard", "tripped");
        return res.status(451).json({ message: "Guard: Cannot import into system folders", folder: folder.name });
      }

      // ---- map rows
      const mapped = rows.map((r) => ({
        "First Name": r[mapping.firstName || ""],
        "Last Name": r[mapping.lastName || ""],
        Email: lcEmail(r[mapping.email || ""]),
        email: lcEmail(r[mapping.email || ""]),
        Phone: r[mapping.phone || ""],
        phoneLast10: last10(r[mapping.phone || ""]),
        normalizedPhone: last10(r[mapping.phone || ""]),
        State: normalizeState(r[mapping.state || ""]),
        Notes: r[mapping.notes || ""],
        userEmail,
        ownerEmail: userEmail,
        folderId: folder._id,
        leadType: sanitizeLeadType(r["Lead Type"] || r["leadType"] || r["LeadType"] || ""),
      }));

      const phoneKeys = Array.from(new Set(mapped.map((m) => m.phoneLast10).filter(Boolean) as string[]));
      const emailKeys = Array.from(new Set(mapped.map((m) => m.Email).filter(Boolean) as string[]));

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
          if (skipExisting) { skipped++; continue; }
          const filter = { userEmail, ...(phoneKey
            ? { $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] }
            : { $or: [{ Email: emailKey }, { email: emailKey }] }) };

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
          if (m.leadType) set["leadType"] = m["leadType"];

          if (m.Phone !== undefined) set["Phone"] = m["Phone"];
          if (phoneKey !== undefined) { set["phoneLast10"] = phoneKey; set["normalizedPhone"] = phoneKey; }
          if (emailKey !== undefined) { set["Email"] = emailKey; set["email"] = emailKey; }

          ops.push({ updateOne: { filter, update: { $set: set }, upsert: false } });
          processedFilters.push(filter);
        } else {
          const filter = { userEmail, ...(phoneKey
            ? { $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] }
            : { $or: [{ Email: emailKey }, { email: emailKey }] }) };

          const setOnInsert: any = {
            userEmail,
            ownerEmail: userEmail,
            status: "New",
            createdAt: new Date(),
          };
          const set: any = {
            folderId: folder._id,
            folder_name: String(folder.name),
            "Folder Name": String(folder.name),
            updatedAt: new Date(),
          };

          if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
          if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
          if (m.State !== undefined) set["State"] = m.State;
          if (m.Notes !== undefined) set["Notes"] = m.Notes;
          if (m.leadType) set["leadType"] = m["leadType"];

          if (m.Phone !== undefined) set["Phone"] = m["Phone"];
          if (phoneKey !== undefined) { set["phoneLast10"] = phoneKey; set["normalizedPhone"] = phoneKey; }
          if (emailKey !== undefined) { set["Email"] = emailKey; set["email"] = emailKey; }

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
          const orFilters = processedFilters.flatMap((f) =>
            (f.$or || []).map((clause: any) => ({ userEmail, ...clause }))
          );
          const affected = await Lead.find({ $or: orFilters }).select("_id");
          const ids = affected.map((d) => String(d._id));
          if (ids.length) {
            await Folder.updateOne({ _id: folder._id, userEmail }, { $addToSet: { leadIds: { $each: ids } } });
          }
        }
      }

      // --- TRACE HEADERS (JSON)
      res.setHeader("X-Import-Trace", TRACE);
      res.setHeader("X-Import-Mode", "json");

      return res.status(200).json({
        message: "Import completed",
        folderId: folder._id,
        folderName: folder.name,
        counts: { inserted, updated, skipped },
        mode: "json",
        skipExisting,
      });
    } catch (e: any) {
      console.error("❌ JSON import error:", e);
      const msg = /system folders/i.test(String(e?.message)) ? String(e?.message) : "Import failed";
      return res.status(400).json({ message: msg, error: e?.message || String(e) });
    }
  }

  // ---------- MULTIPART MODE (CSV upload) ----------
  const form = formidable({ multiples: false });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("❌ Form parse error:", err);
      return res.status(500).json({ message: "Form parse error" });
    }

    let targetFolderId = firstString((fields as any).targetFolderId);
    const folderNameField = detectFolderNameFromForm(fields) || "";
    const mappingStr = firstString((fields as any).mapping);
    const skipExisting = firstString((fields as any).skipExisting) === "true";
    const createNew = truthy((fields as any).createNewFolder);

    console.log("[IMPORT_MP] createNew=%s, folderName=%s, targetFolderId=%s",
      createNew, folderNameField, targetFolderId);

    // If client says "create new", REQUIRE a name and IGNORE any id
    if (createNew) {
      targetFolderId = undefined;
      if (!folderNameField.trim()) {
        return res.status(400).json({ message: "Missing folder name for new folder" });
      }
    }

    const file = Array.isArray((files as any).file) ? (files as any).file[0] : (files as any).file;
    if (!file?.filepath) return res.status(400).json({ message: "Missing file" });

    // New path (mapping provided)
    if (mappingStr) {
      try {
        const mapping = JSON.parse(mappingStr) as Record<string, string>;

        const folder = await resolveImportFolder(userEmail, {
          targetFolderId,
          folderName: folderNameField || undefined,
        });

        res.setHeader("X-Import-Resolver", folderNameField ? "name" : (targetFolderId ? "id" : "missing"));
        console.log("[IMPORT_MP] chosen folder _id=%s name=%s", String(folder._id), folder.name);

        // HARD GUARD (diagnostic): if somehow a system folder sneaks through, trip guard
        if (isSystemFolderName(folder.name) || isBlockedSystemName(folder.name)) {
          res.setHeader("X-Guard", "tripped");
          return res.status(451).json({ message: "Guard: Cannot import into system folders", folder: folder.name });
        }

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
          "First Name": r[mapping.firstName || ""],
          "Last Name":  r[mapping.lastName || ""],
          Email: lcEmail(r[mapping.email || ""]),
          email: lcEmail(r[mapping.email || ""]),
          Phone: r[mapping.phone || ""],
          phoneLast10: last10(r[mapping.phone || ""]),
          normalizedPhone: last10(r[mapping.phone || ""]),
          State: normalizeState(r[mapping.state || ""]),
          Notes: r[mapping.notes || ""],
          userEmail,
          ownerEmail: userEmail,
          folderId: folder._id,
          leadType: sanitizeLeadType(r["Lead Type"] || r["leadType"] || r["LeadType"] || ""),
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
            if (skipExisting) { skipped++; continue; }
            const filter = { userEmail, ...(phoneKey
              ? { $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] }
              : { $or: [{ Email: emailKey }, { email: emailKey }] }) };

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
            if (m.State !== undefined) set["State"] = m["State"];
            if (m.Notes !== undefined) set["Notes"] = m["Notes"];
            if (m.leadType) set["leadType"] = m["leadType"];

            if (m.Phone !== undefined) set["Phone"] = m["Phone"];
            if (phoneKey !== undefined) { set["phoneLast10"] = phoneKey; set["normalizedPhone"] = phoneKey; }
            if (emailKey !== undefined) { set["Email"] = emailKey; set["email"] = emailKey; }

            ops.push({ updateOne: { filter, update: { $set: set }, upsert: false } });
            processedFilters.push(filter);
          } else {
            const filter = { userEmail, ...(phoneKey
              ? { $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] }
              : { $or: [{ Email: emailKey }, { email: emailKey }] }) };

            const setOnInsert: any = {
              userEmail,
              ownerEmail: userEmail,
              status: "New",
              createdAt: new Date(),
            };
            const set: any = {
              folderId: folder._id,
              folder_name: String(folder.name),
              "Folder Name": String(folder.name),
              updatedAt: new Date(),
            };

            if (m["First Name"] !== undefined) set["First Name"] = m["First Name"];
            if (m["Last Name"] !== undefined) set["Last Name"] = m["Last Name"];
            if (m.State !== undefined) set["State"] = m["State"];
            if (m.Notes !== undefined) set["Notes"] = m["Notes"];
            if (m.leadType) set["leadType"] = m["leadType"];

            if (m.Phone !== undefined) set["Phone"] = m["Phone"];
            if (phoneKey !== undefined) { set["phoneLast10"] = phoneKey; set["normalizedPhone"] = phoneKey; }
            if (emailKey !== undefined) { set["Email"] = emailKey; set["email"] = emailKey; }

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
            const orFilters = processedFilters.flatMap((f) =>
              (f.$or || []).map((clause: any) => ({ userEmail, ...clause }))
            );
            const affected = await Lead.find({ $or: orFilters }).select("_id");
            const ids = affected.map((d) => String(d._id));
            if (ids.length) {
              await Folder.updateOne({ _id: folder._id, userEmail }, { $addToSet: { leadIds: { $each: ids } } });
            }
          }
        }

        // --- TRACE HEADERS (multipart+mapping)
        res.setHeader("X-Import-Trace", TRACE);
        res.setHeader("X-Import-Mode", "multipart+mapping");

        return res.status(200).json({
          message: "Leads imported successfully",
          folderId: folder._id,
          folderName: folder.name,
          counts: { inserted, updated, skipped },
          mode: "multipart+mapping",
          skipExisting,
        });
      } catch (e: any) {
        console.error("❌ Multipart mapping import error:", e);
        const msg = /system folders/i.test(String(e?.message)) ? String(e?.message) : "Import failed";
        return res.status(400).json({ message: msg, error: e?.message || String(e) });
      }
    }

    // ---------- Legacy path: folderName + CSV (no mapping provided) ----------
    const folderNameLegacy = folderNameField || detectFolderNameFromForm(fields) || "";
    if (!folderNameLegacy) return res.status(400).json({ message: "Missing folder name" });
    if (isSystemFolderName(folderNameLegacy) || isBlockedSystemName(folderNameLegacy)) {
      res.setHeader("X-Guard", "tripped");
      return res.status(451).json({ message: "Guard: Cannot import into system folders" });
    }

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

      let folder = await Folder.findOne({ name: folderNameLegacy, userEmail });
      if (!folder) folder = await Folder.create({ name: folderNameLegacy, userEmail });

      if (isSystemFolderName(folder.name) || isBlockedSystemName(folder.name)) {
        res.setHeader("X-Guard", "tripped");
        return res.status(451).json({ message: "Guard: Cannot import into system folders" });
      }

      const leadsToInsert = rawLeads.map((lead) => {
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

      // --- TRACE HEADERS (legacy)
      res.setHeader("X-Import-Trace", TRACE);
      res.setHeader("X-Import-Mode", "multipart-legacy");

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

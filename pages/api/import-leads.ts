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
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { sanitizeLeadType, createLeadsFromCSV } from "@/lib/mongo/leads";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

export const config = { api: { bodyParser: false } };

/* ------------------------ helpers & normalizers ------------------------ */
function bufferToStream(buffer: Buffer): Readable {
  const s = new Readable();
  s.push(buffer);
  s.push(null);
  return s;
}
const digits = (s: any) => String(s ?? "").replace(/\D+/g, "");
function last10(v?: string | null) {
  if (v == null) return;
  const k = digits(v).slice(-10);
  return k || undefined;
}
function lcEmail(v?: string | null) {
  if (v == null) return;
  const s = String(v).trim().toLowerCase();
  return s || undefined;
}
function lc(v?: string | null) {
  return v ? String(v).trim().toLowerCase() : undefined;
}

/** Fuzzy “system-ish” test — blocks sold/s0ld/so1d etc. */
function isSystemish(name?: string) {
  if (!name) return false;
  const s = String(name).trim().toLowerCase();
  const canon = s.replace(/[\s_-]+/g, "").replace(/0/g, "o").replace(/[1i]/g, "l");
  return canon === "sold" || isSystemFolder(s);
}

/* US state normalizer (unchanged) */
const STATE_MAP: Record<string, string> = { AL:"AL",ALABAMA:"AL",AK:"AK",ALASKA:"AK",AZ:"AZ",ARIZONA:"AZ",AR:"AR",ARKANSAS:"AR",CA:"CA",CALIFORNIA:"CA",CO:"CO",COLORADO:"CO",CT:"CT",CONNECTICUT:"CT",DE:"DE",DELAWARE:"DE",FL:"FL",FLORIDA:"FL",GA:"GA",GEORGIA:"GA",HI:"HI",HAWAII:"HI",ID:"ID",IDAHO:"ID",IL:"IL",ILLINOIS:"IL",IN:"IN",INDIANA:"IN",IA:"IA",IOWA:"IA",KS:"KS",KANSAS:"KS",KY:"KY",KENTUCKY:"KY",LA:"LA",LOUISIANA:"LA",ME:"ME",MAINE:"ME",MD:"MD",MARYLAND:"MD",MA:"MA",MASSACHUSETTS:"MA",MI:"MI",MICHIGAN:"MI",MN:"MN",MINNESOTA:"MN",MS:"MS",MISSISSIPPI:"MS",MO:"MO",MISSOURI:"MO",MT:"MT",MONTANA:"MT",NE:"NE",NEBRASKA:"NE",NV:"NV",NEVADA:"NV",NH:"NH","NEW HAMPSHIRE":"NH",NJ:"NJ","NEW JERSEY":"NJ",NM:"NM","NEW MEXICO":"NM",NY:"NY","NEW YORK":"NY",NC:"NC","NORTH CAROLINA":"NC",ND:"ND","NORTH DAKOTA":"ND",OH:"OH",OHIO:"OH",OK:"OK",OKLAHOMA:"OK",OR:"OR",OREGON:"OR",PA:"PA",PENNSYLVANIA:"PA",RI:"RI","RHODE ISLAND":"RI",SC:"SC","SOUTH CAROLINA":"SC",SD:"SD","SOUTH DAKOTA":"SD",TN:"TN",TENNESSEE:"TN",TX:"TX",TEXAS:"TX",UT:"UT",UTAH:"UT",VT:"VT",VERMONT:"VT",VA:"VA",VIRGINIA:"VA",WA:"WA",WASHINGTON:"WA",WV:"WV","WEST VIRGINIA":"WV",WI:"WI",WISCONSIN:"WI",WY:"WY",WYOMING:"WY",DC:"DC","DISTRICT OF COLUMBIA":"DC" };
function normalizeState(v?: string | null) {
  if (!v) return;
  const k = String(v).trim().toUpperCase();
  return (
    STATE_MAP[k] ||
    STATE_MAP[k.replace(/\s+/g, "_")] ||
    undefined
  );
}
function sanitizeStatus(v?: string | null) {
  if (!v) return;
  const s = String(v).trim();
  if (!s) return;
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

/* --------- folder selection (NEW FOLDER ONLY; blocks system-ish) --------- */
async function selectImportFolder(
  userEmail: string,
  opts: { folderName?: string; sourceHint?: string }
) {
  const provided = (opts.folderName || "").trim();
  if (provided && isSystemish(provided)) {
    const err: any = new Error("Cannot import into system folders");
    err.status = 400;
    throw err;
  }
  // auto-generated names from sourceHint are sanitized (never system-ish)
  const base =
    (opts.sourceHint && String(opts.sourceHint).trim()) ||
    (provided && String(provided).trim()) ||
    `Google Sheet — ${new Date().toISOString().slice(0, 10)}`;
  const cleaned = base.replace(/\s+/g, " ").trim();
  const safeName = isSystemish(cleaned) ? `${cleaned} (Leads)` : cleaned;

  const folder = await Folder.findOneAndUpdate(
    { userEmail, name: safeName },
    { $setOnInsert: { userEmail, name: safeName } },
    { new: true, upsert: true }
  );
  return { folder, safeName };
}

/* ---------------------------- request bodies ---------------------------- */
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
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return {};
  }
}

/* ------------------------------ mapping ------------------------------ */
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
  // Ignore any mapped status/disposition from rows
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
    // status intentionally NOT set here; we force "New" downstream
  };
}

/* ------------------------------ dedupe ------------------------------ */
function buildFilter(userEmail: string, phoneKey?: string, emailKey?: string) {
  if (phoneKey)
    return {
      userEmail,
      $or: [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }],
    };
  if (emailKey)
    return {
      userEmail,
      $or: [{ Email: emailKey }, { email: emailKey }],
    };
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

/* ================================ handler ================================ */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const userEmail = lc(session.user.email)!;
  await dbConnect();

  // ---------- JSON path (NEW FOLDER ONLY) ----------
  const json = await readJsonBody(req);
  if (json) {
    try {
      const { mapping, rows, skipExisting = false } = json;
      if (!mapping || !rows || !Array.isArray(rows))
        return res
          .status(400)
          .json({ message: "Missing mapping or rows[]" });

      const provided =
        (json.newFolderName ||
          json.newFolder ||
          json.name ||
          json.folderName ||
          "")
          .toString()
          .trim();

      // block system-ish provided names
      if (provided && isSystemish(provided)) {
        return res.status(400).json({ message: "Cannot import into system folders" });
      }

      const { folder, safeName } = await selectImportFolder(userEmail, {
        folderName: provided,
      });

      // map rows & strip any status/disposition
      const mapped = rows.map((r) => {
        const m = { ...mapRow(r, mapping), userEmail, folderId: folder._id } as any;
        delete m.status;
        delete m.Status;
        delete m.Disposition;
        delete m["Disposition"];
        delete m["Status"];
        return m;
      });

      const phoneKeys = Array.from(
        new Set(mapped.map((m) => m.phoneLast10).filter(Boolean) as string[])
      );
      const emailKeys = Array.from(
        new Set(mapped.map((m) => m.Email).filter(Boolean) as string[])
      );

      const ors: any[] = [];
      if (phoneKeys.length)
        ors.push(
          { phoneLast10: { $in: phoneKeys } },
          { normalizedPhone: { $in: phoneKeys } }
        );
      if (emailKeys.length)
        ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });

      const existing = ors.length
        ? await Lead.find({ userEmail, $or: ors }).select(
            "_id phoneLast10 normalizedPhone Email email folderId"
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
        const emailKey =
          (m.Email as string | undefined) || (m.email as string | undefined);
        const exists =
          (phoneKey && byPhone.get(phoneKey)) ||
          (emailKey && byEmail.get(String(emailKey)));
        if (!phoneKey && !emailKey) {
          skipped++;
          continue;
        }
        if (skipExisting && exists) {
          skipped++;
          continue;
        }
        const filter = buildFilter(userEmail, phoneKey, emailKey);
        if (!filter) {
          skipped++;
          continue;
        }

        const base: any = {
          ownerEmail: userEmail,
          folderId: folder._id,
          folder_name: String(folder.name),
          "Folder Name": String(folder.name),
          updatedAt: new Date(),
          // identity mirrors
        };
        applyIdentityFields(base, phoneKey, emailKey, m.Phone);
        if (m["First Name"] !== undefined) base["First Name"] = m["First Name"];
        if (m["Last Name"] !== undefined) base["Last Name"] = m["Last Name"];
        if (m.State !== undefined) base["State"] = m.State;
        if (m.Notes !== undefined) base["Notes"] = m.Notes;
        if (m.leadType) base["leadType"] = m.leadType;

        // ⛔ Force status "New" on both paths
        base.status = "New";

        if (exists) {
          ops.push({
            updateOne: { filter, update: { $set: base }, upsert: false },
          });
          processedFilters.push(filter);
        } else {
          const setOnInsert: any = {
            userEmail,
            status: "New",
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

      let inserted = 0;
      let updated = 0;
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
        message: "Import completed",
        folderId: folder._id,
        folderName: folder.name,
        counts: { inserted, updated, skipped },
        mode: "json-new-folder-only",
        safeName,
        skipExisting,
      });
    } catch (e: any) {
      const code = e?.status === 400 ? 400 : 500;
      console.error("❌ JSON import error:", { userEmail, error: e?.message });
      return res.status(code).json({ message: e?.message || "Import failed" });
    }
  }

  // ---------- MULTIPART path (NEW FOLDER ONLY) ----------
  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error("❌ Form parse error:", err);
      return res.status(500).json({ message: "Form parse error" });
    }

    try {
      const providedNameRaw =
        (fields as any).newFolderName ??
        (fields as any).newFolder ??
        (fields as any).name ??
        (fields as any).folderName;
      const providedName = (Array.isArray(providedNameRaw)
        ? providedNameRaw[0]
        : providedNameRaw) /* string | undefined */?.toString()?.trim() || "";

      if (providedName && isSystemish(providedName)) {
        return res
          .status(400)
          .json({ message: "Cannot import into system folders" });
      }

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!file?.filepath) return res.status(400).json({ message: "Missing file" });

      const mappingStr = (Array.isArray(fields.mapping)
        ? fields.mapping[0]
        : fields.mapping)?.toString();

      const skipExisting =
        (Array.isArray(fields.skipExisting)
          ? fields.skipExisting[0]
          : fields.skipExisting)?.toString() === "true";

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
              acc[String(key).trim()] =
                typeof val === "string" ? val.trim() : val;
              return acc;
            }, {} as Record<string, any>);
            rawRows.push(cleaned);
          })
          .on("end", () => resolve())
          .on("error", (e) => reject(e));
      });
      if (rawRows.length === 0)
        return res
          .status(400)
          .json({ message: "No data rows found in CSV (empty file or header-only)." });

      // If no mapping provided, use legacy insert path — but still force status New
      if (!mappingStr) {
        const leadsToInsert = rawRows.map((lead) => {
          // strip any incoming status/disposition
          const copy = { ...lead };
          delete (copy as any).status;
          delete (copy as any).Status;
          delete (copy as any).Disposition;
          delete (copy as any)["Disposition"];
          delete (copy as any)["Status"];

          const phoneKey = last10(copy["Phone"] || copy["phone"]);
          const emailKey = lcEmail(copy["Email"] || copy["email"]);
          return {
            ...copy,
            userEmail,
            folderId: folder._id,
            folder_name: String(folder.name),
            "Folder Name": String(folder.name),
            status: "New",
            Phone: copy["Phone"] ?? copy["phone"],
            phoneLast10: phoneKey,
            normalizedPhone: phoneKey,
            Email: emailKey,
            email: emailKey,
            leadType: sanitizeLeadType(copy["Lead Type"] || ""),
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

      // With mapping: map & strip status, then upsert with forced New
      const mapping = JSON.parse(mappingStr) as Record<string, string>;
      const rowsMapped = rawRows.map((r) => {
        const m = { ...mapRow(r, mapping), userEmail, folderId: folder._id } as any;
        delete m.status;
        delete m.Status;
        delete m.Disposition;
        delete m["Disposition"];
        delete m["Status"];
        return m;
      });

      const phoneKeys = Array.from(
        new Set(rowsMapped.map((m) => m.phoneLast10).filter(Boolean) as string[])
      );
      const emailKeys = Array.from(
        new Set(rowsMapped.map((m) => m.Email).filter(Boolean) as string[])
      );

      const ors: any[] = [];
      if (phoneKeys.length)
        ors.push(
          { phoneLast10: { $in: phoneKeys } },
          { normalizedPhone: { $in: phoneKeys } }
        );
      if (emailKeys.length)
        ors.push({ Email: { $in: emailKeys } }, { email: { $in: emailKeys } });

      const existing = ors.length
        ? await Lead.find({ userEmail, $or: ors }).select(
            "_id phoneLast10 normalizedPhone Email email folderId"
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
        const emailKey =
          (m.Email as string | undefined) || (m.email as string | undefined);
        const exists =
          (phoneKey && byPhone.get(phoneKey)) ||
          (emailKey && byEmail.get(String(emailKey)));
        if (!phoneKey && !emailKey) {
          skipped++;
          continue;
        }
        if (skipExisting && exists) {
          skipped++;
          continue;
        }
        const filter = buildFilter(userEmail, phoneKey, emailKey);
        if (!filter) {
          skipped++;
          continue;
        }

        const base: any = {
          ownerEmail: userEmail,
          folderId: folder._id,
          folder_name: String(folder.name),
          "Folder Name": String(folder.name),
          updatedAt: new Date(),
          status: "New", // force New on updates too
        };
        applyIdentityFields(base, phoneKey, emailKey, m.Phone);
        if (m["First Name"] !== undefined) base["First Name"] = m["First Name"];
        if (m["Last Name"] !== undefined) base["Last Name"] = m["Last Name"];
        if (m.State !== undefined) base["State"] = m.State;
        if (m.Notes !== undefined) base["Notes"] = m.Notes;
        if (m.leadType) base["leadType"] = m.leadType;

        if (exists) {
          ops.push({
            updateOne: { filter, update: { $set: base }, upsert: false },
          });
          processedFilters.push(filter);
        } else {
          const setOnInsert: any = {
            userEmail,
            status: "New",
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

      let inserted = 0;
      let updated = 0;
      if (ops.length) {
        const result = await (Lead as any).bulkWrite(ops, { ordered: false });
        inserted = (result as any).upsertedCount || 0;
        const existedOps = processedFilters.length - inserted;
        updated = existedOps < 0 ? 0 : existedOps;

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
      const code = e?.status === 400 ? 400 : 500;
      console.error("❌ Multipart import error:", { error: e?.message || String(e) });
      return res.status(code).json({ message: e?.message || "Import failed" });
    }
  });
}

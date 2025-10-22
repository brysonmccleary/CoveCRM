import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import mongoose from "mongoose";
import { google } from "googleapis";
import { DateTime } from "luxon";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

const FINGERPRINT = "selfheal-v5h+seed"; // fingerprint +seed to mark this build

// --- Normalizers -------------------------------------------------------------
const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};
const clean = (v: any) => (v === undefined || v === null ? "" : String(v).trim());

type FolderRaw = {
  _id: mongoose.Types.ObjectId;
  userEmail: string;
  name: string;
};

function nextWindowPT(): Date {
  const PT_ZONE = "America/Los_Angeles";
  const SEND_HOUR_PT = 9;
  const now = DateTime.now().setZone(PT_ZONE);
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  return (now < today9 ? today9 : today9.plus({ days: 1 })).toJSDate();
}

// -----------------------------------------------------------------------------
// NEVER create a system folder. If desired name is systemish, suffix " (Leads)".
// -----------------------------------------------------------------------------
async function ensureNonSystemFolderRaw(
  userEmail: string,
  wantedName: string
): Promise<NonNullable<FolderRaw>> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("DB connection not ready");
  const coll = db.collection("folders");

  const baseName = isSystemFolder(wantedName) ? `${wantedName} (Leads)` : wantedName;

  // 1) Try exact find
  const existing = (await coll.findOne({ userEmail, name: baseName })) as FolderRaw;
  if (existing && existing.name && !isSystemFolder(existing.name)) {
    return existing as NonNullable<FolderRaw>;
  }

  // 2) Create if not found
  const inserted = await coll.insertOne({
    userEmail,
    name: baseName,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const doc = (await coll.findOne({ _id: inserted.insertedId })) as FolderRaw | null;
  if (!doc) throw new Error("Failed to create folder");
  return doc as NonNullable<FolderRaw>;
}

// -----------------------------------------------------------------------------
// Seed *newly imported* leads into any active DripFolderEnrollment watchers
// for this folder, so the first message can go out without waiting for the
// 5-minute scan job. We only upsert if the lead has NO active/paused enrollment
// for that same campaign.
// -----------------------------------------------------------------------------
async function seedNewImportsIntoActiveWatchers(
  userEmail: string,
  folderId: mongoose.Types.ObjectId,
  newLeadIds: mongoose.Types.ObjectId[]
) {
  if (!newLeadIds.length) return;

  const watchers = await DripFolderEnrollment.find({
    userEmail,
    folderId,
    active: true,
  })
    .select({ _id: 1, campaignId: 1, startMode: 1 })
    .lean<{ _id: mongoose.Types.ObjectId; campaignId: mongoose.Types.ObjectId; startMode?: "immediate" | "nextWindow" }[]>();

  if (!watchers.length) return;

  const now = new Date();
  const whenNext = (startMode?: string) =>
    startMode === "nextWindow" ? nextWindowPT() : now;

  // For each watcher, insert enrollments for new leads that don't already have one.
  for (const w of watchers) {
    // Check which of this batch already has an enrollment
    const existing = await DripEnrollment.find({
      userEmail,
      campaignId: w.campaignId,
      leadId: { $in: newLeadIds },
      status: { $in: ["active", "paused"] },
    })
      .select({ leadId: 1 })
      .lean<{ leadId: mongoose.Types.ObjectId }[]>();

    const already = new Set((existing || []).map((e) => String(e.leadId)));
    const toInsert = newLeadIds.filter((id) => !already.has(String(id)));

    if (!toInsert.length) continue;

    // Bulk upsert to avoid race conditions
    const bulkOps = toInsert.map((leadId) => ({
      updateOne: {
        filter: {
          userEmail,
          leadId,
          campaignId: w.campaignId,
          status: { $in: ["active", "paused"] },
        },
        update: {
          $setOnInsert: {
            userEmail,
            leadId,
            campaignId: w.campaignId,
            status: "active",
            cursorStep: 0,
            nextSendAt: whenNext(w.startMode),
            source: "folder-bulk",
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    if (bulkOps.length) {
      await DripEnrollment.bulkWrite(bulkOps, { ordered: false });
    }
  }
}

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", fingerprint: FINGERPRINT });
  }

  // Accept secret via header or query
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken =
    typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  const provided = headerToken || queryToken;
  if ((process.env.CRON_SECRET || "") && provided !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: "Forbidden", fingerprint: FINGERPRINT });
  }

  // Optional debug/filters
  const onlyUserEmail =
    typeof req.query.userEmail === "string"
      ? (req.query.userEmail as string).toLowerCase()
      : undefined;
  const onlySpreadsheetId =
    typeof req.query.spreadsheetId === "string"
      ? (req.query.spreadsheetId as string)
      : undefined;
  const onlyTitle =
    typeof req.query.title === "string" ? (req.query.title as string) : undefined;
  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const debug = req.query.debug === "1" || req.query.debug === "true";

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB connection not ready (post-connect)");

    // include legacy shape users too
    const users = await User.find({
      ...(onlyUserEmail ? { email: onlyUserEmail } : {}),
      $or: [
        { "googleSheets.syncedSheets.0": { $exists: true } },
        { "googleSheets.sheets.0": { $exists: true } },
      ],
    })
      .limit(onlyUserEmail ? 999 : MAX_USERS)
      .select({ email: 1, googleSheets: 1 })
      .lean<{ email: string; googleSheets?: any }[]>();

    const auth = new google.auth.OAuth2({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    });

    const detailsAll: any[] = [];

    for (const u of users) {
      const userEmail = (u.email || "").toLowerCase();

      // unified list of sheet configs (supports new and legacy shapes)
      const sheetCfgs: Array<{
        spreadsheetId: string;
        title?: string;
        token?: string;
        accessToken?: string;
        refreshToken?: string;
        pointer?: number;
      }> = [];

      const syncedSheets = ((u as any).googleSheets?.syncedSheets || []) as any[];
      for (const s of syncedSheets) {
        if (!s?.spreadsheetId) continue;
        sheetCfgs.push({
          spreadsheetId: String(s.spreadsheetId),
          title: s.title ? String(s.title) : undefined,
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
          pointer: Number(s.lastRowImported || 1),
        });
      }

      const legacy = ((u as any).googleSheets?.sheets || []) as any[];
      for (const s of legacy) {
        if (!s?.sheetId) continue;
        sheetCfgs.push({
          spreadsheetId: String(s.sheetId),
          title: s.tabName ? String(s.tabName) : undefined,
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
          pointer: Number(s.lastRowImported || 1),
        });
      }

      for (const cfg of sheetCfgs) {
        const { spreadsheetId } = cfg;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;

        // set credentials (per-user)
        auth.setCredentials({
          access_token: cfg.accessToken,
          refresh_token: cfg.refreshToken,
        });

        const sheets = google.sheets({ version: "v4", auth });
        const drive = google.drive({ version: "v3", auth });

        let title = cfg.title;
        if (!title) {
          try {
            const meta = await sheets.spreadsheets.get({
              spreadsheetId,
              includeGridData: false,
            });
            const found = meta?.data?.sheets?.[0];
            if (found?.properties?.title) {
              title = found.properties.title;
            }
          } catch { /* ignore */ }
        }
        if (onlyTitle && title && title !== onlyTitle) continue;
        if (!title) title = "Sheet1";

        // ---- DESTINATION FOLDER — ALWAYS computed, NEVER from cfg
        const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const computedDefault = `${driveMeta.data.name || "Imported Leads"} — ${title}`;

        const folderDoc = await ensureNonSystemFolderRaw(userEmail, computedDefault);
        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;
        const targetFolderName = String(folderDoc.name || "");

        // Persist sanitized link (unless dry run) — write-only, we do NOT read this back to pick destination
        if (!dryRun) {
          await User.updateOne(
            {
              email: userEmail,
              $or: [
                { "googleSheets.syncedSheets.spreadsheetId": spreadsheetId },
                { "googleSheets.sheets.sheetId": spreadsheetId }, // legacy mapping
              ],
            },
            {
              $set: {
                ...(title ? { "googleSheets.syncedSheets.$[t].title": title } : {}),
                ...(title ? { "googleSheets.sheets.$[l].tabName": title } : {}),
              },
            },
            {
              arrayFilters: [
                { "t.spreadsheetId": spreadsheetId },
                { "l.sheetId": spreadsheetId },
              ],
            }
          ).catch(() => {/* best-effort */});
        }

        // Read rows incrementally from the pointer
        const pointer = Math.max(1, Number(cfg.pointer || 1));
        const startRow = Math.max(pointer, 1);
        const endRow = Math.max(startRow + MAX_ROWS_PER_SHEET - 1, startRow);

        // pull a block of rows
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${title}!A${startRow}:Z${endRow}`,
          valueRenderOption: "UNFORMATTED_VALUE",
          dateTimeRenderOption: "SERIAL_NUMBER",
        });

        const values = (r.data.values || []) as any[][];
        if (!values.length) {
          detailsAll.push({ userEmail, spreadsheetId, title, imported: 0, updated: 0, lastProcessed: startRow - 1 });
          continue;
        }

        const headers = (values[0] || []).map((h) => clean(h));
        const rows = values.slice(1);

        let imported = 0;
        let updated = 0;
        let lastProcessed = startRow - 1;

        const newlyCreatedIds: mongoose.Types.ObjectId[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] || [];
          const pointer = startRow + i + 1; // “sheet row” number for this data row

          lastProcessed = pointer;

          // Map headers -> object
          const obj: Record<string, any> = {};
          for (let c = 0; c < headers.length; c++) {
            const h = headers[c] || "";
            const v = row[c];
            obj[h] = v;
          }

          // Normalize a few common fields
          const doc: Record<string, any> = { userEmail, ...obj };
          const p = normPhone(doc["Phone"] ?? doc["phone"] ?? "");
          const e = normEmail(doc["Email"] ?? doc["email"] ?? "");

          // Build a “natural key” filter: by phone and/or email (per user)
          const or: any[] = [];
          if (p) or.push({ normalizedPhone: p });
          if (e) or.push({ email: e });

          const filter = { userEmail, ...(or.length ? { $or: or } : {}) };
          const existing = await Lead.findOne(filter)
            .select("_id")
            .lean<{ _id: mongoose.Types.ObjectId } | null>();

          if (!existing) {
            if (!dryRun) {
              const created = await Lead.create({
                ...doc,
                folderId: targetFolderId,
                folder_name: targetFolderName,
                ["Folder Name"]: targetFolderName,
              });
              newlyCreatedIds.push(created._id as mongoose.Types.ObjectId);
            }
            imported++;
          } else {
            if (!dryRun)
              await Lead.updateOne(
                { _id: existing._id },
                {
                  $set: {
                    ...doc,
                    folderId: targetFolderId,
                    folder_name: targetFolderName,
                    ["Folder Name"]: targetFolderName,
                  },
                }
              );
            updated++;
          }
        }

        const newLast = Math.max(lastProcessed + 1, Number(pointer));
        if (!dryRun) {
          // Try to set pointer on both shapes (best-effort)
          await User.updateOne(
            {
              email: userEmail,
              "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
            },
            {
              $set: {
                "googleSheets.syncedSheets.$.lastRowImported": newLast,
                "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$.folderId": targetFolderId,
                "googleSheets.syncedSheets.$.folderName": targetFolderName,
              },
            }
          ).catch(() => {/* ignore if not present */});

          await User.updateOne(
            {
              email: userEmail,
              "googleSheets.sheets.sheetId": spreadsheetId,
            },
            {
              $set: {
                "googleSheets.sheets.$.lastRowImported": newLast,
                "googleSheets.sheets.$.lastImportedAt": new Date(),
                "googleSheets.sheets.$.folderId": targetFolderId,
                "googleSheets.sheets.$.folderName": targetFolderName,
              },
            }
          ).catch(() => {/* ignore if not present */});
        }

        // ✅ NEW: immediately seed *newly created* leads into any active folder watcher
        if (!dryRun && newlyCreatedIds.length) {
          await seedNewImportsIntoActiveWatchers(userEmail, targetFolderId, newlyCreatedIds);
        }

        detailsAll.push({
          userEmail,
          spreadsheetId,
          title,
          imported,
          updated,
          lastProcessed,
          folderId: String(targetFolderId),
          folderName: targetFolderName,
          seededNewEnrollments: newlyCreatedIds.length,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      build: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || undefined,
      details: detailsAll,
      fingerprint: FINGERPRINT,
    });
  } catch (err: any) {
    console.error("Sheets poll error:", err);
    return res.status(500).json({ error: err?.message || "Cron poll failed", fingerprint: FINGERPRINT });
  }
}

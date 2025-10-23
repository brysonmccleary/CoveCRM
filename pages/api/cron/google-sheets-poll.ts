// /pages/api/cron/google-sheets-poll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import DripEnrollment from "@/models/DripEnrollment";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import mongoose from "mongoose";
import { google } from "googleapis";
import { DateTime } from "luxon";
import { ensureSafeFolder } from "@/lib/ensureSafeFolder";

const FINGERPRINT = "sheets-poll-v5-sheetId-map";

// --- Normalizers -------------------------------------------------------------
const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};
const clean = (v: any) => (v === undefined || v === null ? "" : String(v).trim());

// NEW: make header keys Mongo-safe and skip empties
const sanitizeKey = (k: any) => {
  let s = clean(k);
  if (!s) return "";           // <- signal to skip
  s = s.replace(/\./g, "_");   // Mongo disallows dots in keys
  s = s.replace(/^\$+/, "");   // disallow leading $
  return s.trim();
};

function nextWindowPT(): Date {
  const PT_ZONE = "America/Los_Angeles";
  const SEND_HOUR_PT = 9;
  const now = DateTime.now().setZone(PT_ZONE);
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  return (now < today9 ? today9 : today9.plus({ days: 1 })).toJSDate();
}

// -----------------------------------------------------------------------------
// Seed *newly imported* leads into any active DripFolderEnrollment watchers
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

  for (const w of watchers) {
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
  const headerRowParam =
    typeof req.query.headerRow === "string" ? Math.max(1, parseInt(req.query.headerRow, 10) || 1) : undefined;

  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const debug = req.query.debug === "1" || req.query.debug === "true";

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();
    const db = mongoose.connection.db;
    if (!db) throw new Error("DB connection not ready (post-connect)");

    // -------- USER DISCOVERY -------------------------------------------------
    const userFilter: any = {
      ...(onlyUserEmail ? { email: onlyUserEmail } : {}),
      $or: [
        { "googleSheets.syncedSheets.0": { $exists: true } },
        { "googleSheets.sheets.0": { $exists: true } },
        { "googleSheets.refreshToken": { $exists: true, $ne: "" } }, // self-heal path
      ],
    };

    const users = await User.find(userFilter)
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
        accessToken?: string;
        refreshToken?: string;
        pointer?: number;
        _selfSeed?: boolean; // indicates we seeded this on-the-fly
        folderId?: mongoose.Types.ObjectId; // optional
        folderName?: string;                // optional
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
          folderId: s.folderId,
          folderName: s.folderName,
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
          folderId: s.folderId,
          folderName: s.folderName,
        });
      }

      // ---------- SELF-HEAL SEEDING -----------------------------------------
      if (sheetCfgs.length === 0) {
        const rootRefresh = (u as any)?.googleSheets?.refreshToken || "";
        if (rootRefresh && onlySpreadsheetId) {
          sheetCfgs.push({
            spreadsheetId: onlySpreadsheetId,
            title: onlyTitle,
            refreshToken: rootRefresh,
            pointer: Number(headerRowParam || 1),
            _selfSeed: true,
          });
        }
      }

      if (sheetCfgs.length === 0) {
        if (debug) {
          detailsAll.push({
            userEmail,
            reason: "no-configs",
            note: "No syncedSheets/sheets and no spreadsheetId query to seed.",
          });
        }
        continue;
      }

      // ---------- PROCESS EACH SHEET CONFIG ---------------------------------
      for (const cfg of sheetCfgs) {
        const { spreadsheetId } = cfg;

        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;

        auth.setCredentials({
          access_token: cfg.accessToken,
          refresh_token: cfg.refreshToken,
        });

        const sheets = google.sheets({ version: "v4", auth });
        const drive = google.drive({ version: "v3", auth });

        // Resolve title if missing
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
        if (!title) title = "Sheet1";
        if (onlyTitle && title && title !== onlyTitle) continue;

        // ---- DESTINATION FOLDER — STRICTLY keyed by sheetId
        const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const computedDefault = `${driveMeta.data.name || "Imported Leads"} — ${title}`.trim();

        const folderDoc = await ensureSafeFolder({
          userEmail,
          folderId: cfg.folderId as any,
          folderName: cfg.folderName,
          defaultName: computedDefault,
          source: "google-sheets",
          sheetId: spreadsheetId, // <- THE KEY
        });

        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;
        const targetFolderName = String(folderDoc.name || "");

        // Persist back to user config (best-effort)
        if (!dryRun && title) {
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
                "googleSheets.syncedSheets.$[t].title": title,
                "googleSheets.sheets.$[l].tabName": title,
                "googleSheets.syncedSheets.$[t].folderId": targetFolderId,
                "googleSheets.syncedSheets.$[t].folderName": targetFolderName,
                "googleSheets.sheets.$[l].folderId": targetFolderId,
                "googleSheets.sheets.$[l].folderName": targetFolderName,
              },
            },
            { arrayFilters: [{ "t.spreadsheetId": spreadsheetId }, { "l.sheetId": spreadsheetId }] }
          ).catch(() => {/* best-effort */});
        }

        // Read rows incrementally from the pointer
        const pointer = Math.max(1, Number(cfg.pointer || 1));
        const startRow = Math.max(pointer, 1);
        const endRow = Math.max(startRow + MAX_ROWS_PER_SHEET - 1, startRow);

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

        // SANITIZE HEADERS: skip blanks and unsafe keys
        const rawHeaders = (values[0] || []) as any[];
        const headers = rawHeaders.map(sanitizeKey).filter(Boolean);
        const rows = values.slice(1);

        let imported = 0;
        let updated = 0;
        let lastProcessed = startRow - 1;

        const newlyCreatedIds: mongoose.Types.ObjectId[] = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] || [];
          const sheetRowNumber = startRow + i + 1;
          lastProcessed = sheetRowNumber;

          // Build doc from sanitized headers only
          const obj: Record<string, any> = {};
          for (let c = 0; c < headers.length; c++) {
            const h = headers[c];
            obj[h] = row[c];
          }

          const doc: Record<string, any> = { userEmail, ...obj };
          const p = normPhone(doc["Phone"] ?? doc["phone"] ?? "");
          const e = normEmail(doc["Email"] ?? doc["email"] ?? "");

          const or: any[] = [];
          if (p) or.push({ normalizedPhone: p });
          if (e) or.push({ email: e });

          const filter = { userEmail, ...(or.length ? { $or: or } : {}) };
          const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();

          if (!existing) {
            if (!dryRun) {
              const created = await Lead.create({
                ...doc,
                folderId: targetFolderId,
                folder_name: targetFolderName,
                ["Folder Name"]: targetFolderName,
                source: "google-sheets",
                sourceSpreadsheetId: spreadsheetId,
                sourceTabTitle: title,
              });
              newlyCreatedIds.push(created._id as mongoose.Types.ObjectId);
            }
            imported++;
          } else {
            if (!dryRun) {
              await Lead.updateOne(
                { _id: existing._id },
                {
                  $set: {
                    ...doc,
                    folderId: targetFolderId,
                    folder_name: targetFolderName,
                    ["Folder Name"]: targetFolderName,
                    source: "google-sheets",
                    sourceSpreadsheetId: spreadsheetId,
                    sourceTabTitle: title,
                  },
                }
              );
            }
            updated++;
          }
        }

        const newLast = Math.max(lastProcessed + 1, Number(pointer));
        if (!dryRun) {
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

        // Seed new leads into active folder watchers (drip) immediately
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

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

const FINGERPRINT = "sheets-poll-v5.4-payload-standardized+row-errors";

const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const last10 = (p: string) => (p ? p.slice(-10) : "");
const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};
const clean = (v: any) => (v === undefined || v === null ? "" : String(v).trim());
const sanitizeKey = (k: any) => {
  let s = clean(k);
  if (!s) return "";
  s = s.replace(/\./g, "_");
  s = s.replace(/^\$+/, "");
  return s.trim();
};

function nextWindowPT(): Date {
  const PT_ZONE = "America/Los_Angeles";
  const SEND_HOUR_PT = 9;
  const now = DateTime.now().setZone(PT_ZONE);
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  return (now < today9 ? today9 : today9.plus({ days: 1 })).toJSDate();
}

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
  const whenNext = (startMode?: string) => (startMode === "nextWindow" ? nextWindowPT() : now);

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

    if (bulkOps.length) await DripEnrollment.bulkWrite(bulkOps, { ordered: false });
  }
}

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", fingerprint: FINGERPRINT });
  }

  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken = typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  const provided = headerToken || queryToken;
  if ((process.env.CRON_SECRET || "") && provided !== process.env.CRON_SECRET) {
    return res.status(403).json({ error: "Forbidden", fingerprint: FINGERPRINT });
  }

  const onlyUserEmail =
    typeof req.query.userEmail === "string"
      ? (req.query.userEmail as string).toLowerCase()
      : undefined;
  const onlySpreadsheetId =
    typeof req.query.spreadsheetId === "string" ? (req.query.spreadsheetId as string) : undefined;
  const onlyTitle = typeof req.query.title === "string" ? (req.query.title as string) : undefined;
  const headerRowParam =
    typeof req.query.headerRow === "string" ? Math.max(1, parseInt(req.query.headerRow, 10) || 1) : undefined;

  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const debug = req.query.debug === "1" || req.query.debug === "true";

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();

    const userFilter: any = {
      ...(onlyUserEmail ? { email: onlyUserEmail } : {}),
      $or: [
        { "googleSheets.syncedSheets.0": { $exists: true } },
        { "googleSheets.sheets.0": { $exists: true } },
        { "googleSheets.refreshToken": { $exists: true, $ne: "" } },
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
      const gs: any = (u as any).googleSheets || {};
      const rootRefresh = gs.refreshToken || "";

      const sheetCfgs: Array<{
        spreadsheetId: string;
        title?: string;
        accessToken?: string;
        refreshToken?: string;
        pointer?: number;
        headerRow?: number;
        _selfSeed?: boolean;
        folderId?: mongoose.Types.ObjectId;
        folderName?: string;
      }> = [];

      const syncedSheets = (gs.syncedSheets || []) as any[];
      for (const s of syncedSheets) {
        if (!s?.spreadsheetId) continue;
        sheetCfgs.push({
          spreadsheetId: String(s.spreadsheetId),
          title: s.title ? String(s.title) : undefined,
          accessToken: s.accessToken,
          refreshToken: s.refreshToken || rootRefresh,
          pointer: Number(s.lastRowImported || 2),
          headerRow: Number(s.headerRow || 1),
          folderId: s.folderId,
          folderName: s.folderName,
        });
      }

      const legacy = (gs.sheets || []) as any[];
      for (const s of legacy) {
        if (!s?.sheetId) continue;
        sheetCfgs.push({
          spreadsheetId: String(s.sheetId),
          title: s.tabName ? String(s.tabName) : undefined,
          accessToken: s.accessToken,
          refreshToken: s.refreshToken || rootRefresh,
          pointer: Number(s.lastRowImported || 2),
          headerRow: Number(s.headerRow || 1),
          folderId: s.folderId,
          folderName: s.folderName,
        });
      }

      if (sheetCfgs.length === 0) {
        if (rootRefresh && onlySpreadsheetId) {
          sheetCfgs.push({
            spreadsheetId: onlySpreadsheetId,
            title: onlyTitle,
            refreshToken: rootRefresh,
            pointer: Number(headerRowParam || 1) + 1,
            headerRow: Number(headerRowParam || 1),
            _selfSeed: true,
          });
        } else {
          if (debug) detailsAll.push({ userEmail, reason: "no-configs" });
          continue;
        }
      }

      for (const cfg of sheetCfgs) {
        const { spreadsheetId } = cfg;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;
        if (!cfg.refreshToken) {
          detailsAll.push({ userEmail, spreadsheetId, title: cfg.title, error: "missing-refresh-token" });
          continue;
        }

        auth.setCredentials({
          access_token: cfg.accessToken,
          refresh_token: cfg.refreshToken,
        });

        const sheets = google.sheets({ version: "v4", auth });
        const drive = google.drive({ version: "v3", auth });

        let title = cfg.title;
        if (!title) {
          try {
            const meta = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
            const found = meta?.data?.sheets?.[0];
            if (found?.properties?.title) title = found.properties.title;
          } catch { /* ignore */ }
        }
        if (!title) title = "Sheet1";
        if (onlyTitle && title && title !== onlyTitle) continue;

        // Folder by sheetId (never system)
        const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const computedDefault = `${driveMeta.data.name || "Imported Leads"} — ${title}`.trim();
        const folderDoc = await ensureSafeFolder({
          userEmail,
          folderId: cfg.folderId as any,
          folderName: cfg.folderName,
          defaultName: computedDefault,
          source: "google-sheets",
          sheetId: spreadsheetId,
        });
        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;
        const targetFolderName = String(folderDoc.name || "");

        const headerRow = Math.max(1, Number(cfg.headerRow || 1));
        let pointer = Math.max(headerRow + 1, Number(cfg.pointer || headerRow + 1));

        // headers
        const headerResp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${title}!A${headerRow}:Z${headerRow}`,
          valueRenderOption: "UNFORMATTED_VALUE",
          dateTimeRenderOption: "SERIAL_NUMBER",
        });
        const headers = (headerResp.data.values?.[0] || []).map(sanitizeKey).filter(Boolean);
        if (!headers.length) {
          detailsAll.push({ userEmail, spreadsheetId, title, error: "empty-headers" });
          continue;
        }

        // data
        const startRow = pointer;
        const endRow = Math.max(startRow + MAX_ROWS_PER_SHEET - 1, startRow);
        let dataResp = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `${title}!A${startRow}:Z${endRow}`,
          valueRenderOption: "UNFORMATTED_VALUE",
          dateTimeRenderOption: "SERIAL_NUMBER",
        });
        let rows = (dataResp.data.values || []) as any[][];

        // auto-rewind if nothing after pointer
        if (!rows.length && startRow > headerRow + 1) {
          pointer = headerRow + 1;
          if (!dryRun) {
            await User.updateMany(
              { email: userEmail },
              {
                $set: {
                  "googleSheets.syncedSheets.$[t].lastRowImported": pointer,
                  "googleSheets.sheets.$[l].lastRowImported": pointer,
                },
              },
              { arrayFilters: [{ "t.spreadsheetId": spreadsheetId }, { "l.sheetId": spreadsheetId }] }
            ).catch(() => {});
          }
          dataResp = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${title}!A${pointer}:Z${pointer + MAX_ROWS_PER_SHEET - 1}`,
            valueRenderOption: "UNFORMATTED_VALUE",
            dateTimeRenderOption: "SERIAL_NUMBER",
          });
          rows = (dataResp.data.values || []) as any[][];
        }

        if (!rows.length) {
          detailsAll.push({
            userEmail, spreadsheetId, title,
            imported: 0, updated: 0, lastProcessed: pointer - 1,
            folderId: String(targetFolderId), folderName: targetFolderName,
            note: "no-rows-after-pointer"
          });
          continue;
        }

        let imported = 0;
        let updated = 0;
        let lastProcessed = pointer - 1;
        const newlyCreatedIds: mongoose.Types.ObjectId[] = [];
        const rowErrors: Array<{ row: number; message: string }> = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] || [];
          const sheetRowNumber = startRow + i;
          lastProcessed = sheetRowNumber;

          const obj: Record<string, any> = {};
          for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c];

          const phoneRaw = obj["Phone"] ?? obj["phone"] ?? "";
          const p = normPhone(phoneRaw);
          const p10 = last10(p);
          const e = normEmail(obj["Email"] ?? obj["email"] ?? "");

          if (!p && !e) {
            // skip rows without identifiers
            continue;
          }

          // standardize payload fields (match your UI & other importers)
          const baseDoc: Record<string, any> = {
            userEmail,
            status: "New",
            // identity
            Phone: phoneRaw ?? "",
            phone: phoneRaw ?? "",
            normalizedPhone: p || undefined,
            phoneLast10: p10 || undefined,
            Email: e || undefined,
            email: e || undefined,
            // folder
            folderId: targetFolderId,
            folder_name: targetFolderName,
            ["Folder Name"]: targetFolderName,
            // source
            source: "google-sheets",
            sourceSpreadsheetId: spreadsheetId,
            sourceTabTitle: title,
          };

          // copy all sheet fields as-is (sanitized header names)
          for (const k of Object.keys(obj)) {
            if (obj[k] !== undefined) baseDoc[k] = obj[k];
          }

          const or: any[] = [];
          if (p) or.push({ normalizedPhone: p });
          if (e) or.push({ email: e });

          const filter = { userEmail, ...(or.length ? { $or: or } : {}) };

          try {
            if (dryRun) {
              // simulate branch: count would be insert if no match
              const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();
              if (!existing) {
                imported++;
              } else {
                updated++;
              }
            } else {
              const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();
              if (!existing) {
                const created = await Lead.create({ ...baseDoc, createdAt: new Date() });
                newlyCreatedIds.push(created._id as mongoose.Types.ObjectId);
                imported++;
              } else {
                await Lead.updateOne({ _id: existing._id }, { $set: { ...baseDoc, updatedAt: new Date() } });
                updated++;
              }
            }
          } catch (err: any) {
            rowErrors.push({ row: sheetRowNumber, message: err?.message || String(err) });
          }
        }

        const newLast = Math.max(lastProcessed + 1, pointer);
        if (!dryRun) {
          await User.updateOne(
            { email: userEmail, "googleSheets.syncedSheets.spreadsheetId": spreadsheetId },
            {
              $set: {
                "googleSheets.syncedSheets.$.lastRowImported": newLast,
                "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$.folderId": targetFolderId,
                "googleSheets.syncedSheets.$.folderName": targetFolderName,
              },
            }
          ).catch(() => {});
          await User.updateOne(
            { email: userEmail, "googleSheets.sheets.sheetId": spreadsheetId },
            {
              $set: {
                "googleSheets.sheets.$.lastRowImported": newLast,
                "googleSheets.sheets.$.lastImportedAt": new Date(),
                "googleSheets.sheets.$.folderId": targetFolderId,
                "googleSheets.sheets.$.folderName": targetFolderName,
              },
            }
          ).catch(() => {});
        }

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
          rowErrors,
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

/* pages/api/cron/google-sheets-poll.ts */
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import mongoose from "mongoose";
import { google } from "googleapis";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

export const config = { maxDuration: 60 };
const FP = "selfheal-v5g";

const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => String(v ?? "").trim().toLowerCase();
const normHeader = (s: any) =>
  String(s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

type SyncedSheetCfg = {
  spreadsheetId: string;
  title?: string;
  sheetId?: number;
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
  lastRowImported?: number;
  folderId?: mongoose.Types.ObjectId | string;
  folderName?: string;
};

async function getFolderSafe(opts: {
  userEmail: string;
  defaultName: string;
  hintId?: string;
  hintName?: string;
}) {
  const { userEmail, defaultName, hintId, hintName } = opts;

  // 1) If a name was stored and it’s non-system, upsert by name
  if (hintName && !isSystemFolder(hintName)) {
    const doc = await Folder.findOneAndUpdate(
      { userEmail, name: hintName },
      { $setOnInsert: { userEmail, name: hintName, source: "google-sheets" } },
      { new: true, upsert: true }
    ).lean();
    if (doc && !isSystemFolder(doc.name)) return doc;
  }

  // 2) If an id was stored, make sure it’s valid & non-system
  if (hintId && mongoose.isValidObjectId(hintId)) {
    const found = await Folder.findOne({ _id: new mongoose.Types.ObjectId(hintId), userEmail }).lean();
    if (found && !isSystemFolder(found.name)) return found;
  }

  // 3) Use the default computed per-tab folder (never a system name)
  const safeName = isSystemFolder(defaultName) ? `${defaultName} (Leads)` : defaultName;
  const def = await Folder.findOneAndUpdate(
    { userEmail, name: safeName },
    { $setOnInsert: { userEmail, name: safeName, source: "google-sheets" } },
    { new: true, upsert: true }
  ).lean();

  // Double-guard: in the impossible case it’s still system, suffix and create again
  if (!def || isSystemFolder(def.name)) {
    const fallback = `${safeName} — ${Date.now()}`;
    return await Folder.findOneAndUpdate(
      { userEmail, name: fallback },
      { $setOnInsert: { userEmail, name: fallback, source: "google-sheets" } },
      { new: true, upsert: true }
    ).lean();
  }

  return def;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", fingerprint: FP });
  }

  // auth: x-cron-secret header OR ?token=
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken = typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  if ((headerToken || queryToken) !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized", fingerprint: FP });
  }

  const onlyUserEmail =
    typeof req.query.userEmail === "string" ? (req.query.userEmail as string).toLowerCase() : undefined;
  const onlySpreadsheetId = typeof req.query.spreadsheetId === "string" ? (req.query.spreadsheetId as string) : undefined;
  const onlyTitle = typeof req.query.title === "string" ? (req.query.title as string) : undefined;
  const dryRun = ["1", "true", "yes"].includes(String(req.query.dryRun || "").toLowerCase());
  const debug = ["1", "true", "yes"].includes(String(req.query.debug || "").toLowerCase());

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();

    const users = await User.find({
      ...(onlyUserEmail ? { email: onlyUserEmail } : {}),
      $or: [
        { "googleSheets.syncedSheets.0": { $exists: true } },
        { "googleSheets.sheets.0": { $exists: true } },
      ],
    })
      .limit(MAX_USERS)
      .lean();

    const details: any[] = [];

    for (const u of users) {
      const userEmail = String((u as any).email || "").toLowerCase();
      const gs: any = (u as any).googleSheets || {};
      const legacy: any = (u as any).googleTokens || {};
      const tok = gs?.refreshToken ? gs : legacy?.refreshToken ? legacy : null;
      if (!tok?.refreshToken) {
        details.push({ userEmail, note: "No Google refresh token", fingerprint: FP });
        continue;
      }

      const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID!,
        process.env.GOOGLE_CLIENT_SECRET!,
        `${base}/api/connect/google-sheets/callback`
      );
      oauth2.setCredentials({
        access_token: tok.accessToken,
        refresh_token: tok.refreshToken,
        expiry_date: tok.expiryDate,
      });

      const drive = google.drive({ version: "v3", auth: oauth2 });
      const sheetsApi = google.sheets({ version: "v4", auth: oauth2 });

      const rawCfgs: any[] =
        (gs?.syncedSheets?.length ? gs.syncedSheets : (gs?.sheets || [])) as any[];
      if (!rawCfgs.length) {
        details.push({ userEmail, note: "No syncedSheets/sheets", fingerprint: FP });
        continue;
      }

      for (const cfg of rawCfgs) {
        let {
          spreadsheetId,
          title,
          sheetId,
          headerRow = 1,
          mapping = {},
          skip = {},
          lastRowImported,
          folderId,
          folderName,
        } = (cfg || {}) as SyncedSheetCfg;

        // legacy alias
        if (!spreadsheetId && typeof (cfg as any)?.sheetId === "string" && (cfg as any).sheetId.length > 12) {
          spreadsheetId = (cfg as any).sheetId;
          sheetId = typeof (cfg as any)?.tabId === "number" ? (cfg as any).tabId : sheetId;
        }

        if (!spreadsheetId) continue;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;

        if (sheetId != null) {
          try {
            const meta = await sheetsApi.spreadsheets.get({
              spreadsheetId,
              fields: "sheets(properties(sheetId,title))",
            });
            const found = (meta.data.sheets || []).find(s => s.properties?.sheetId === sheetId);
            if (found?.properties?.title) title = found.properties.title;
          } catch {}
        }
        if (onlyTitle && title && title !== onlyTitle) continue;
        if (!title) continue;

        // Compute default folder name from Drive file name + tab title
        const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const computedDefault = `${driveMeta.data.name || "Imported Leads"} — ${title}`;

        // ALWAYS resolve to a non-system folder (even if a bad folderId/name is stored)
        const safeFolder = await getFolderSafe({
          userEmail,
          defaultName: computedDefault,
          hintId: folderId ? String(folderId) : undefined,
          hintName: folderName,
        });
        const targetFolderId = safeFolder?._id as mongoose.Types.ObjectId;
        const targetFolderName = String(safeFolder?.name || "");

        // Heal the user config to the safe folder (best-effort)
        if (!dryRun) {
          await User.updateOne(
            {
              email: userEmail,
              $or: [
                { "googleSheets.syncedSheets.spreadsheetId": spreadsheetId },
                { "googleSheets.sheets.sheetId": spreadsheetId },
              ],
            },
            {
              $set: {
                "googleSheets.syncedSheets.$[t].title": title,
                "googleSheets.syncedSheets.$[t].folderId": targetFolderId,
                "googleSheets.syncedSheets.$[t].folderName": targetFolderName,
              },
            },
            { arrayFilters: [{ "t.spreadsheetId": spreadsheetId }] }
          ).catch(() => {});
          await User.updateOne(
            { email: userEmail, "googleSheets.sheets.sheetId": spreadsheetId },
            {
              $set: {
                "googleSheets.sheets.$.folderId": targetFolderId,
                "googleSheets.sheets.$.folderName": targetFolderName,
              },
            }
          ).catch(() => {});
        }

        // fetch values
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const headers = (values[headerIdx] || []).map(h => String(h ?? "").trim());

        // normalize mapping
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping || {}).forEach(([key, val]) => {
          if (typeof val === "string" && val) normalizedMapping[normHeader(key)] = val;
        });

        const pointer = typeof lastRowImported === "number" ? lastRowImported : headerRow;
        const firstDataZero = headerIdx + 1;
        let startIndex = Math.max(firstDataZero, Number(pointer));
        if (startIndex > values.length - 1) startIndex = firstDataZero;
        const endIndex = Math.min(values.length - 1, startIndex + MAX_ROWS_PER_SHEET - 1);

        let imported = 0, updated = 0, skippedNoKey = 0, lastProcessed = Number(pointer) - 1;

        if (startIndex <= endIndex) {
          for (let r = startIndex; r <= endIndex; r++) {
            const row = values[r] || [];
            const hasAny = row.some(c => String(c ?? "").trim() !== "");
            if (!hasAny) continue;
            lastProcessed = r;

            const doc: Record<string, any> = {};
            headers.forEach((actualHeader, i) => {
              const key = normHeader(actualHeader);
              if (!key) return;
              if ((skip || {})[actualHeader]) return;
              const field = normalizedMapping[key];
              if (!field) return;
              doc[field] = row[i] ?? "";
            });

            const p = normPhone(doc.phone ?? (doc as any).Phone);
            const e = normEmail(doc.email ?? (doc as any).Email);
            if (!p && !e) { skippedNoKey++; continue; }

            doc.userEmail = userEmail;
            doc.source = "google-sheets";
            doc.sourceSpreadsheetId = spreadsheetId;
            doc.sourceTabTitle = title;
            doc.sourceRowIndex = r + 1;
            doc.normalizedPhone = p || undefined;
            if (e) doc.email = e;

            const or: any[] = [];
            if (p) or.push({ normalizedPhone: p });
            if (e) or.push({ email: e });

            const filter = { userEmail, ...(or.length ? { $or: or } : {}) };
            const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();

            if (!existing) {
              if (!dryRun) {
                await Lead.create({
                  ...doc,
                  folderId: targetFolderId,
                  folder_name: targetFolderName,
                  ["Folder Name"]: targetFolderName,
                });
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
                    },
                  }
                );
              }
              updated++;
            }
          }
        }

        const newLast = Math.max(lastProcessed + 1, Number(pointer));
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

        details.push({
          userEmail,
          spreadsheetId,
          title,
          headerRow,
          pointerWas: pointer,
          startIndex,
          endIndex,
          rowCount: values.length,
          imported,
          updated,
          skippedNoKey,
          newLastRowImported: newLast,
          dryRun,
          fingerprint: FP,
          resolvedFolder: {
            id: String(targetFolderId),
            name: targetFolderName,
            isSystem: isSystemFolder(targetFolderName),
          },
          ...(debug ? { diag: { computedDefault, assignedDrip: false } } : {}),
        });
      }
    }

    return res.status(200).json({
      ok: true,
      build: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || undefined,
      details,
      fingerprint: FP,
    });
  } catch (err: any) {
    console.error("Sheets poll error:", err);
    return res.status(500).json({ error: err?.message || "Cron poll failed", fingerprint: FP });
  }
}

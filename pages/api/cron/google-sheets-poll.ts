import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import mongoose from "mongoose";
import { google } from "googleapis";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

const FINGERPRINT = "selfheal-v5d"; // +legacy-user-shape support; TS fix for mapping entries

// --- Normalizers -------------------------------------------------------------
const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};
const normHeader = (s: any) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

type SyncedSheetCfg = {
  spreadsheetId: string;
  title?: string;
  sheetId?: number;
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
  lastRowImported?: number;
};

type FolderRaw = {
  _id: mongoose.Types.ObjectId;
  name?: string;
  userEmail?: string;
  source?: string;
} | null;

// ---------- RAW helpers (folders) ----------
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
  if (existing && existing.name && !isSystemFolder(existing.name)) return existing as NonNullable<FolderRaw>;

  // 2) Upsert exact name (safely extract value)
  const up = await coll.findOneAndUpdate(
    { userEmail, name: baseName },
    { $setOnInsert: { userEmail, name: baseName, source: "google-sheets" } },
    { upsert: true, returnDocument: "after" }
  );
  const doc = (up && (up as any).value) as FolderRaw;

  // 3) Sanity: if still system or missing, force a unique safe name
  if (!doc || !doc.name || isSystemFolder(doc.name)) {
    const uniqueSafe = `${baseName} — ${Date.now()}`;
    const ins = await coll.insertOne({ userEmail, name: uniqueSafe, source: "google-sheets" });
    const fresh = (await coll.findOne({ _id: ins.insertedId })) as FolderRaw;
    if (!fresh || !fresh.name || isSystemFolder(fresh.name)) {
      throw new Error(
        `Folder rewrite detected. Expected non-system '${uniqueSafe}', got '${fresh?.name}'.`
      );
    }
    return fresh as NonNullable<FolderRaw>;
  }

  return doc as NonNullable<FolderRaw>;
}

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
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized", fingerprint: FINGERPRINT });
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
      .limit(MAX_USERS)
      .lean();

    const detailsAll: any[] = [];

    for (const user of users) {
      const userEmail = String((user as any).email || "").toLowerCase();

      const gs: any = (user as any).googleSheets || {};
      const legacy: any = (user as any).googleTokens || {};
      const tok = gs?.refreshToken ? gs : legacy?.refreshToken ? legacy : null;
      if (!tok?.refreshToken) {
        detailsAll.push({ userEmail, note: "No Google refresh token", fingerprint: FINGERPRINT });
        continue;
      }

      const base =
        process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
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

      // support both shapes
      const rawConfigs: any[] =
        (gs?.syncedSheets && Array.isArray(gs.syncedSheets) && gs.syncedSheets.length
          ? gs.syncedSheets
          : (gs?.sheets && Array.isArray(gs.sheets) ? gs.sheets : [])) as any[];

      if (!rawConfigs?.length) {
        detailsAll.push({ userEmail, note: "No syncedSheets or sheets", fingerprint: FINGERPRINT });
        continue;
      }

      for (const cfg of rawConfigs) {
        // Normalize cfg fields across shapes
        let {
          spreadsheetId,
          title,
          sheetId,
          headerRow = 1,
          mapping = {},
          skip = {},
          lastRowImported,
        } = cfg || {};

        // Legacy aliasing: some legacy lists used "sheetId" to mean the spreadsheetId string.
        if (!spreadsheetId && typeof cfg?.sheetId === "string" && cfg.sheetId.length > 12) {
          spreadsheetId = cfg.sheetId;
          sheetId = typeof cfg?.tabId === "number" ? cfg.tabId : sheetId;
        }

        if (!spreadsheetId) continue;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;

        // Resolve current tab title if we have sheetId (tab may have been renamed)
        if (sheetId != null) {
          try {
            const meta = await sheetsApi.spreadsheets.get({
              spreadsheetId,
              fields: "sheets(properties(sheetId,title))",
            });
            const found = (meta.data.sheets || []).find(
              (s) => s.properties?.sheetId === sheetId
            );
            if (found?.properties?.title) {
              title = found.properties.title;
            }
          } catch { /* ignore */ }
        }
        if (onlyTitle && title && title !== onlyTitle) continue;
        if (!title) continue;

        // ---- DESTINATION FOLDER (raw driver only)
        const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const computedDefault = `${driveMeta.data.name || "Imported Leads"} — ${title}`;

        const folderDoc = await ensureNonSystemFolderRaw(userEmail, computedDefault);
        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;
        const targetFolderName = String(folderDoc.name || "");

        // Persist sanitized link (unless dry run)
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
                ...(cfg.title
                  ? { "googleSheets.syncedSheets.$[t].title": title }
                  : {}),
                "googleSheets.syncedSheets.$[t].folderId": targetFolderId,
                "googleSheets.syncedSheets.$[t].folderName": targetFolderName,
                ...(sheetId != null
                  ? { "googleSheets.syncedSheets.$[t].sheetId": sheetId }
                  : {}),
              },
            },
            {
              arrayFilters: [
                { "t.spreadsheetId": spreadsheetId },
              ],
              multi: true,
              upsert: false,
            }
          ).catch(() => {/* ignore if arrayFilters doesn't match legacy doc */});

          // Legacy array shape write (best-effort)
          await User.updateOne(
            {
              email: userEmail,
              "googleSheets.sheets.sheetId": spreadsheetId,
            },
            {
              $set: {
                "googleSheets.sheets.$.folderId": targetFolderId,
                "googleSheets.sheets.$.folderName": targetFolderName,
              },
            }
          ).catch(() => {/* ignore if not legacy */});
        }

        // --- Read values ----------------------------------------------------
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) => String(h ?? "").trim());

        const normalizedMapping: Record<string, string> = {};
        // 🔧 TS fix: cast entries + guard val is string
        Object.entries(mapping as Record<string, unknown>).forEach(([key, val]) => {
          if (typeof val === "string" && val) {
            normalizedMapping[normHeader(key)] = val;
          }
        });

        const pointer = typeof lastRowImported === "number" ? lastRowImported : headerRow;
        const firstDataZero = headerIdx + 1;
        let startIndex = Math.max(firstDataZero, Number(pointer));
        if (startIndex > values.length - 1) startIndex = firstDataZero;

        const endIndex = Math.min(values.length - 1, startIndex + MAX_ROWS_PER_SHEET - 1);

        let imported = 0;
        let updated = 0;
        let skippedNoKey = 0;
        let lastProcessed = Number(pointer) - 1;

        if (startIndex <= endIndex) {
          for (let r = startIndex; r <= endIndex; r++) {
            const row = values[r] || [];
            const hasAny = row.some((c) => String(c ?? "").trim() !== "");
            if (!hasAny) continue;
            lastProcessed = r;

            const doc: Record<string, any> = {};
            rawHeaders.forEach((actualHeader, i) => {
              const n = normHeader(actualHeader);
              if (!n) return;
              if ((skip || {})[actualHeader]) return;
              const fieldName = normalizedMapping[n];
              if (!fieldName) return;
              doc[fieldName] = row[i] ?? "";
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
            const existing = await Lead.findOne(filter)
              .select("_id")
              .lean<{ _id: mongoose.Types.ObjectId } | null>();

            if (!existing) {
              if (!dryRun) await Lead.create({
                ...doc,
                folderId: targetFolderId,
                folder_name: targetFolderName,
                ["Folder Name"]: targetFolderName
              });
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
                      ["Folder Name"]: targetFolderName
                    }
                  }
                );
              updated++;
            }
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

        detailsAll.push({
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
          fingerprint: FINGERPRINT,
          resolvedFolder: {
            id: String(targetFolderId),
            name: targetFolderName,
            isSystem: isSystemFolder(targetFolderName),
          },
          ...(debug
            ? {
                diag: {
                  computedDefault,
                  rawBypassed: true,
                },
              }
            : {}),
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

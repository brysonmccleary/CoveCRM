import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import mongoose from "mongoose";
import { google } from "googleapis";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";
import { ensureSafeFolder } from "@/lib/ensureSafeFolder";
import { sendInitialDrip } from "@/utils/sendInitialDrip";

const FINGERPRINT = "selfheal-v5f";

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
  spreadsheetId?: string;   // new shape
  sheetId?: number;         // tab id (optional)
  title?: string;           // tab title
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
  lastRowImported?: number;

  // legacy shape aliasing:
  // googleSheets.sheets[].sheetId === spreadsheetId (string)
  // googleSheets.sheets[].tabId === sheetId (number)
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", fingerprint: FINGERPRINT });
  }

  // Auth via secret header or token query
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken = typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  const provided = headerToken || queryToken;
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized", fingerprint: FINGERPRINT });
  }

  // Filters & flags
  const onlyUserEmail =
    typeof req.query.userEmail === "string" ? (req.query.userEmail as string).toLowerCase() : undefined;
  const onlySpreadsheetId =
    typeof req.query.spreadsheetId === "string" ? (req.query.spreadsheetId as string) : undefined;
  const onlyTitle = typeof req.query.title === "string" ? (req.query.title as string) : undefined;

  const dryRun = ["1", "true", "yes"].includes(String(req.query.dryRun || "").toLowerCase());
  const debug = ["1", "true", "yes"].includes(String(req.query.debug || "").toLowerCase());

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();

    // users who actually have a connection + a configured sheet list (new or legacy)
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

      // OAuth setup
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

      // Normalize to a single list of configs
      const rawConfigs: SyncedSheetCfg[] = (() => {
        const modern = Array.isArray(gs?.syncedSheets) ? gs.syncedSheets : [];
        const legacyArr = Array.isArray(gs?.sheets) ? gs.sheets : [];
        if (modern.length) return modern as any[];
        if (legacyArr.length) {
          // adapt legacy items
          return legacyArr.map((x: any) => ({
            spreadsheetId: typeof x.sheetId === "string" ? x.sheetId : undefined,
            sheetId: typeof x.tabId === "number" ? x.tabId : undefined,
            title: x.title,
            headerRow: x.headerRow,
            mapping: x.mapping,
            skip: x.skip,
            lastRowImported: x.lastRowImported,
          }));
        }
        return [];
      })();

      if (!rawConfigs.length) {
        detailsAll.push({ userEmail, note: "No syncedSheets/sheets", fingerprint: FINGERPRINT });
        continue;
      }

      for (const cfg of rawConfigs) {
        let { spreadsheetId, title, sheetId, headerRow = 1, mapping = {}, skip = {}, lastRowImported } = cfg || {};
        if (!spreadsheetId) continue;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;

        // If we know the tab id, fetch the live title (handles renames)
        if (sheetId != null) {
          try {
            const meta = await sheetsApi.spreadsheets.get({
              spreadsheetId,
              fields: "sheets(properties(sheetId,title))",
            });
            const found = (meta.data.sheets || []).find((s) => s.properties?.sheetId === sheetId);
            if (found?.properties?.title) title = found.properties.title;
          } catch {/* ignore */}
        }
        if (!title) continue;
        if (onlyTitle && title !== onlyTitle) continue;

        // Resolve destination folder (safe/human-friendly)
        const fileMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const computedDefault = `${fileMeta.data.name || "Imported Leads"} — ${title}`;
        const folderDoc = await ensureSafeFolder({
          userEmail,
          folderId: (cfg as any).folderId,   // keep any pinned folder if valid
          folderName: (cfg as any).folderName,
          defaultName: computedDefault,
          source: "google-sheets",
        });

        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;
        const targetFolderName = String(folderDoc.name || "");

        // Persist sanitized link back to the user doc (best effort for both shapes)
        if (!dryRun) {
          // modern
          await User.updateOne(
            { email: userEmail, "googleSheets.syncedSheets.spreadsheetId": spreadsheetId },
            {
              $set: {
                "googleSheets.syncedSheets.$.folderId": targetFolderId,
                "googleSheets.syncedSheets.$.folderName": targetFolderName,
                ...(sheetId != null ? { "googleSheets.syncedSheets.$.sheetId": sheetId } : {}),
                ...(title ? { "googleSheets.syncedSheets.$.title": title } : {}),
              },
            }
          ).catch(() => {});
          // legacy
          await User.updateOne(
            { email: userEmail, "googleSheets.sheets.sheetId": spreadsheetId },
            {
              $set: {
                "googleSheets.sheets.$.folderId": targetFolderId,
                "googleSheets.sheets.$.folderName": targetFolderName,
                ...(title ? { "googleSheets.sheets.$.title": title } : {}),
              },
            }
          ).catch(() => {});
        }

        // Read data
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) => String(h ?? "").trim());

        // Normalize column header mapping
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping as Record<string, unknown>).forEach(([key, val]) => {
          if (typeof val === "string" && val) normalizedMapping[normHeader(key)] = val;
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

        // Pre-fetch folder to know if a drip is assigned
        const fullFolder = await Folder.findById(targetFolderId).lean<any>();
        const folderHasAssignedDrip =
          !!((fullFolder as any)?.assignedDrip || (fullFolder as any)?.assignedDrips?.length);

        if (startIndex <= endIndex) {
          for (let r = startIndex; r <= endIndex; r++) {
            const row = values[r] || [];
            const hasAny = row.some((c) => String(c ?? "").trim() !== "");
            if (!hasAny) continue;
            lastProcessed = r;

            // Build a doc per mapping/skip
            const doc: Record<string, any> = {};
            rawHeaders.forEach((actualHeader, i) => {
              const n = normHeader(actualHeader);
              if (!n) return;
              if ((skip || {})[actualHeader]) return;
              const fieldName = normalizedMapping[n];
              if (!fieldName) return;
              doc[fieldName] = row[i] ?? "";
            });

            // Keys
            const p = normPhone(doc.phone ?? (doc as any).Phone);
            const e = normEmail(doc.email ?? (doc as any).Email);
            if (!p && !e) { skippedNoKey++; continue; }

            // Common fields we stamp
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
                const created = await Lead.create({
                  ...doc,
                  folderId: targetFolderId,
                  folder_name: targetFolderName,
                  ["Folder Name"]: targetFolderName,
                  status: doc.status || "New",
                });
                imported++;

                // 🚀 Initial drip if folder enrolled
                if (folderHasAssignedDrip) {
                  const agentName = (fullFolder as any)?.agentName || (user as any)?.name || "your agent";
                  const agentPhone = (fullFolder as any)?.agentPhone || (user as any)?.phoneNumber || "N/A";
                  const dripLead = {
                    ...created.toObject(),
                    name:
                      created["First Name"] || created["Last Name"]
                        ? [created["First Name"], created["Last Name"]].filter(Boolean).join(" ")
                        : created.name || "",
                    phone: created.Phone || created.phone,
                    folderName: targetFolderName,
                    agentName,
                    agentPhone,
                  };
                  try { await sendInitialDrip(dripLead as any); } catch { /* non-fatal */ }
                }
              }
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
          // modern pointer
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
          // legacy pointer
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
          ...(debug ? { diag: { computedDefault: computedDefault, rawBypassed: false, assignedDrip: !!folderHasAssignedDrip } } : {}),
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

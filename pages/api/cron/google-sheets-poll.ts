// /pages/api/cron/google-sheets-poll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

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
  folderId?: string;
  folderName?: string;
  lastRowImported?: number;
};

type LeanFolder =
  | { _id: mongoose.Types.ObjectId; name?: string; userEmail?: string }
  | null;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken =
    typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  const provided = headerToken || queryToken;
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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

    const users = await User.find({
      ...(onlyUserEmail ? { email: onlyUserEmail } : {}),
      "googleSheets.syncedSheets.0": { $exists: true },
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
        detailsAll.push({ userEmail, note: "No Google refresh token" });
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

      const syncedSheets: SyncedSheetCfg[] = (gs?.syncedSheets || []) as any[];
      if (!syncedSheets?.length) {
        detailsAll.push({ userEmail, note: "No syncedSheets" });
        continue;
      }

      for (const cfg of syncedSheets) {
        let {
          spreadsheetId,
          title,
          sheetId,
          headerRow = 1,
          mapping = {},
          skip = {},
          folderId,
          folderName,
          lastRowImported,
        } = cfg || {};

        if (!spreadsheetId) continue;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;
        if (onlyTitle && title && title !== onlyTitle) continue;

        // Resolve current tab title if we have sheetId
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
          } catch {
            /* ignore */
          }
        }
        if (!title) continue;

        // --- Resolve/Correct destination folder (BLOCK system folders) ---
        let folderDoc: { _id: mongoose.Types.ObjectId; name?: string } | null =
          null;
        let reasonGuard: string | undefined;

        // (1) If a folderId is present, try to load it and check system-ness
        if (folderId) {
          try {
            const f = (await Folder.findOne({
              _id: new mongoose.Types.ObjectId(folderId),
              userEmail,
            }).lean()) as LeanFolder;

            if (f && f.name && isSystemFolder(f.name)) {
              // 🔴 Hard block: purge bad link so it can't reappear later
              reasonGuard = "blocked-by-system-id";
              if (!dryRun) {
                await User.updateOne(
                  {
                    email: userEmail,
                    "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
                    "googleSheets.syncedSheets.title": cfg.title ?? title,
                  },
                  {
                    $set: {
                      "googleSheets.syncedSheets.$.folderId": null,
                      "googleSheets.syncedSheets.$.folderName": null,
                    },
                  }
                );
              }
              folderDoc = null; // force re-resolve below
            } else if (f) {
              folderDoc = f as any;
            }
          } catch {
            // fall through to re-resolve
            folderDoc = null;
          }
        }

        // (2) If no usable doc yet, compute a SAFE name and upsert the folder
        if (!folderDoc) {
          const driveMeta = await drive.files.get({
            fileId: spreadsheetId,
            fields: "name",
          });
          const proposedBase =
            folderName && !isSystemFolder(folderName)
              ? folderName
              : `${driveMeta.data.name || "Imported Leads"} — ${title}`.trim();

          const safeName = isSystemFolder(proposedBase)
            ? `${proposedBase} (Leads)`
            : proposedBase;

          const up = await Folder.findOneAndUpdate(
            { userEmail, name: safeName },
            {
              $setOnInsert: {
                userEmail,
                name: safeName,
                source: "google-sheets",
              },
            },
            { new: true, upsert: true }
          ).lean();

          folderDoc = (up as any) || null;

          // Persist the corrected link back to the user doc (unless dry run)
          if (!dryRun && folderDoc?._id) {
            await User.updateOne(
              {
                email: userEmail,
                "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
                "googleSheets.syncedSheets.title": cfg.title ?? title,
              },
              {
                $set: {
                  "googleSheets.syncedSheets.$.folderId": folderDoc._id,
                  "googleSheets.syncedSheets.$.folderName":
                    (folderDoc as any)?.name || safeName,
                },
              }
            );
          }
        }

        // At this point, folderDoc is guaranteed to be non-system (by name) and exists.
        const targetFolderId = folderDoc!._id as mongoose.Types.ObjectId;

        // --- Read values ---
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) =>
          String(h ?? "").trim()
        );

        // tolerant mapping: normalize header keys once
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping || {}).forEach(([key, val]) => {
          normalizedMapping[normHeader(key)] = val;
        });

        const pointer =
          typeof lastRowImported === "number" ? lastRowImported : headerRow;
        const firstDataZero = headerIdx + 1; // 0-based first data row
        let startIndex = Math.max(firstDataZero, Number(pointer));
        if (startIndex > values.length - 1) startIndex = firstDataZero;

        const endIndex = Math.min(
          values.length - 1,
          startIndex + MAX_ROWS_PER_SHEET - 1
        );

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

            // Build doc using tolerant mapping
            const doc: Record<string, any> = {};
            rawHeaders.forEach((actualHeader, i) => {
              const n = normHeader(actualHeader);
              if (!n) return;
              if (skip?.[actualHeader]) return;
              const fieldName = normalizedMapping[n];
              if (!fieldName) return;
              doc[fieldName] = row[i] ?? "";
            });

            const p = normPhone(doc.phone ?? (doc as any).Phone);
            const e = normEmail(doc.email ?? (doc as any).Email);
            if (!p && !e) {
              skippedNoKey++;
              continue;
            }

            doc.userEmail = userEmail;
            doc.source = "google-sheets";
            doc.sourceSpreadsheetId = spreadsheetId;
            doc.sourceTabTitle = title;
            doc.sourceRowIndex = r + 1; // 1-based
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
              if (!dryRun)
                await Lead.create({ ...doc, folderId: targetFolderId });
              imported++;
            } else {
              if (!dryRun)
                await Lead.updateOne(
                  { _id: existing._id },
                  { $set: { ...doc, folderId: targetFolderId } }
                );
              updated++;
            }
          }
        }

        const newLast = Math.max(lastProcessed + 1, Number(pointer));
        if (!dryRun) {
          await User.updateOne(
            {
              email: userEmail,
              "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
              "googleSheets.syncedSheets.title": cfg.title ?? title,
            },
            {
              $set: {
                "googleSheets.syncedSheets.$.lastRowImported": newLast,
                "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$.folderId": targetFolderId,
                "googleSheets.syncedSheets.$.folderName":
                  (folderDoc as any)?.name || "",
                ...(sheetId != null
                  ? { "googleSheets.syncedSheets.$.sheetId": sheetId }
                  : {}),
                ...(cfg.title !== title
                  ? { "googleSheets.syncedSheets.$.title": title }
                  : {}),
              },
            }
          );
        }

        const detail: any = {
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
          resolvedFolder: {
            id: String(targetFolderId),
            name: (folderDoc as any)?.name || "",
            isSystem: isSystemFolder((folderDoc as any)?.name || ""),
            ...(reasonGuard ? { reasonGuard } : {}),
          },
        };
        if (debug) {
          detail.mapping = mapping;
          detail.headers = rawHeaders;
        }
        detailsAll.push(detail);
      }
    }

    return res.status(200).json({
      ok: true,
      build: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 8) || undefined,
      details: detailsAll,
    });
  } catch (err: any) {
    console.error("Sheets poll error:", err);
    return res.status(500).json({ error: err?.message || "Cron poll failed" });
  }
}

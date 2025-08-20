// /pages/api/cron/google-sheets-poll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";

// --- Normalizers -------------------------------------------------------------
const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};
// normalize header keys for tolerant matching: trim, collapse space/_/-, lowercase
const normHeader = (s: any) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

type SyncedSheetCfg = {
  spreadsheetId: string;
  title?: string;         // saved tab title at time of import
  sheetId?: number;       // <-- we will prefer this if present
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
  folderId?: string;
  folderName?: string;
  lastRowImported?: number; // 1-based index of the LAST imported row
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Token via header or query
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken =
    typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  const provided = headerToken || queryToken;
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
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

    const users = await User.find({
      ...(onlyUserEmail ? { email: onlyUserEmail } : {}),
      "googleSheets.syncedSheets.0": { $exists: true },
    })
      .limit(MAX_USERS)
      .lean();

    const detailsAll: any[] = [];

    for (const user of users) {
      const userEmail = String((user as any).email || "").toLowerCase();

      // token from googleSheets or legacy googleTokens
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

        // If we have a sheetId, resolve current title (tab might be renamed)
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
            // ignore and try title as-is
          }
        }
        if (!title) continue; // still no title—skip safely

        // Ensure folder exists
        let folderDoc: any = null;
        if (folderId) {
          try {
            folderDoc = await Folder.findOne({
              _id: new mongoose.Types.ObjectId(folderId),
            });
          } catch {
            /* noop */
          }
        }
        if (!folderDoc) {
          const meta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
          const defaultName =
            folderName || `${meta.data.name || "Imported Leads"} — ${title}`;
          folderDoc = await Folder.findOneAndUpdate(
            { userEmail, name: defaultName },
            { $setOnInsert: { userEmail, name: defaultName, source: "google-sheets" } },
            { new: true, upsert: true }
          );
        }
        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;

        // Read values
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) => String(h ?? "").trim());

        // Build a tolerant header index map
        const headerNormToActual = new Map<string, string>();
        rawHeaders.forEach((h) => headerNormToActual.set(normHeader(h), h));

        // Normalize mapping keys once (so "First  Name", "first_name", "First-Name" all match)
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping || {}).forEach(([key, val]) => {
          normalizedMapping[normHeader(key)] = val;
        });

        // Determine start/end using pointer (1-based last imported)
        const pointer = typeof lastRowImported === "number" ? lastRowImported : headerRow;
        const firstDataZero = headerIdx + 1; // 0-based
        // Convert 1-based LAST imported -> next row (0-based) = max(firstDataZero, pointer)
        let startIndex = Math.max(firstDataZero, Number(pointer));
        // If the sheet shrank or pointer drifted too far, clamp back to first data row
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

            // Build doc using tolerant mapping
            const doc: Record<string, any> = {};
            rawHeaders.forEach((actualHeader, i) => {
              const n = normHeader(actualHeader);
              if (!n) return;
              if (skip?.[actualHeader]) return; // honor skip only by actual header text
              const fieldName = normalizedMapping[n];
              if (!fieldName) return;
              doc[fieldName] = row[i] ?? "";
            });

            const p = normPhone(doc.phone ?? doc.Phone);
            const e = normEmail(doc.email ?? doc.Email);
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
            const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();

            if (!existing) {
              doc.folderId = targetFolderId;
              if (!dryRun) await Lead.create(doc);
              imported++;
            } else {
              if (!dryRun) {
                await Lead.updateOne({ _id: existing._id }, { $set: { ...doc, folderId: targetFolderId } });
              }
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
              "googleSheets.syncedSheets.title": cfg.title ?? title, // match either saved or current title
            },
            {
              $set: {
                "googleSheets.syncedSheets.$.lastRowImported": newLast,
                "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$.folderId": targetFolderId,
                "googleSheets.syncedSheets.$.folderName": folderDoc.name,
                ...(sheetId != null ? { "googleSheets.syncedSheets.$.sheetId": sheetId } : {}),
                // keep saved title in sync if it changed
                ...(cfg.title !== title ? { "googleSheets.syncedSheets.$.title": title } : {}),
              },
            }
          );
        }

        const detail: any = {
          userEmail,
          spreadsheetId,
          title,
          sheetId,
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
        };
        if (debug) {
          detail.headers = rawHeaders;
          detail.normalizedHeaders = rawHeaders.map(normHeader);
          detail.mapping = mapping;
          detail.mappingNormalized = normalizedMapping;
        }
        detailsAll.push(detail);
      }
    }

    if (debug) console.log("Sheets poll (debug) →", JSON.stringify(detailsAll, null, 2));
    return res.status(200).json({ ok: true, details: detailsAll });
  } catch (err: any) {
    console.error("Sheets poll error:", err);
    return res.status(500).json({ error: err?.message || "Cron poll failed" });
  }
}

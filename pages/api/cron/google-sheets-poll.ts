// /pages/api/cron/google-sheets-poll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";
import { autoEnrollNewLeads } from "@/lib/mongo/leads";

/**
 * This poller supports BOTH saved shapes:
 *  A) new flow:   { spreadsheetId, title?, sheetId?, headerRow?, mapping?, skip?, folderId?, folderName?, lastRowImported? }
 *  B) legacy flow: { sheetId (this is actually the spreadsheetId), sheetName, folderId? }
 */

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
  sheetId?: number;       // numeric Google "sheetId" (tab id)
  headerRow?: number;
  mapping?: Record<string, string>;   // optional: <sheet header> -> <field name>, e.g. "Phone" -> "phone"
  skip?: Record<string, boolean>;     // headers to ignore (by EXACT header text)
  folderId?: string;
  folderName?: string;
  lastRowImported?: number;           // 1-based index of the LAST imported row
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

    // ✅ support both shapes (syncedSheets AND legacy sheets)
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

      // Normalize config list across BOTH shapes
      const rawNew = Array.isArray(gs?.syncedSheets) ? gs.syncedSheets : [];
      const rawLegacy = Array.isArray(gs?.sheets) ? gs.sheets : [];

      const normalized: SyncedSheetCfg[] = [
        // already in the right shape
        ...rawNew,
        // legacy -> normalized
        ...rawLegacy.map((x: any) => ({
          spreadsheetId: String(x.sheetId || ""),   // legacy stored spreadsheet id in "sheetId"
          title: x.sheetName || undefined,
          headerRow: 1,
          folderId: x.folderId ? String(x.folderId) : undefined,
        })),
      ].filter((c) => c && c.spreadsheetId);

      if (!normalized.length) {
        detailsAll.push({ userEmail, note: "No syncedSheets or legacy sheets" });
        continue;
      }

      for (const cfg of normalized) {
        let {
          spreadsheetId,
          title,
          sheetId,
          headerRow = 1,
          mapping = {},   // may be empty; we have a safe fallback
          skip = {},
          folderId,
          folderName,
          lastRowImported,
        } = cfg || {};

        if (!spreadsheetId) continue;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;
        if (onlyTitle && title && title !== onlyTitle) continue;

        // If we have a numeric sheetId (tab id), resolve current tab title (tab might be renamed)
        if (typeof sheetId === "number") {
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
        if (!title) {
          // fall back to the first sheet title if none provided
          try {
            const meta = await sheetsApi.spreadsheets.get({
              spreadsheetId,
              fields: "sheets(properties(title))",
            });
            title = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
          } catch {
            continue; // no title resolvable
          }
        }

        // Ensure folder exists or create a default one if folderId unknown
        let folderDoc: any = null;
        if (folderId) {
          try {
            folderDoc = await Folder.findOne({
              _id: new mongoose.Types.ObjectId(folderId),
              userEmail,
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
        if (!values.length) {
          detailsAll.push({
            userEmail,
            spreadsheetId,
            title,
            rowCount: 0,
            imported: 0,
            updated: 0,
            skippedNoKey: 0,
            newLastRowImported: headerRow,
            dryRun,
            note: "No data in sheet",
          });
          continue;
        }

        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) => String(h ?? "").trim());

        // Build a tolerant header index map
        const headerNormToActual = new Map<string, string>();
        rawHeaders.forEach((h) => headerNormToActual.set(normHeader(h), h));

        // robust default mapping (if cfg.mapping is empty)
        const defaultMap: Record<string, string> = {};
        for (const [norm, actual] of headerNormToActual.entries()) {
          if (!norm) continue;
          if (["first name", "firstname"].includes(norm)) defaultMap[actual] = "First Name";
          else if (["last name", "lastname"].includes(norm)) defaultMap[actual] = "Last Name";
          else if (["phone", "phone number", "phone1", "phonenumber"].includes(norm)) defaultMap[actual] = "phone";
          else if (["email", "e-mail"].includes(norm)) defaultMap[actual] = "email";
          else if (["state"].includes(norm)) defaultMap[actual] = "State";
          else if (["notes", "note"].includes(norm)) defaultMap[actual] = "Notes";
          else if (["dob", "date of birth"].includes(norm)) defaultMap[actual] = "DOB";
          else if (["coverage amount"].includes(norm)) defaultMap[actual] = "Coverage Amount";
          else if (["beneficiary"].includes(norm)) defaultMap[actual] = "Beneficiary";
          else if (["age"].includes(norm)) defaultMap[actual] = "Age";
        }

        // Normalize provided mapping: key = normalized header, value = field name
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping || {}).forEach(([key, val]) => {
          normalizedMapping[normHeader(key)] = val;
        });

        // Final mapping used by the poller: prefer explicit mapping, fallback to defaults
        function resolveFieldName(actualHeader: string): string | undefined {
          const byExplicit = normalizedMapping[normHeader(actualHeader)];
          if (byExplicit) return byExplicit;
          return defaultMap[actualHeader]; // default is keyed by ACTUAL header
        }

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
        const newLeadIds: mongoose.Types.ObjectId[] = [];

        if (startIndex <= endIndex) {
          for (let r = startIndex; r <= endIndex; r++) {
            const row = values[r] || [];
            const hasAny = row.some((c) => String(c ?? "").trim() !== "");
            if (!hasAny) continue;
            lastProcessed = r;

            // Build doc using tolerant mapping (explicit mapping first, fallback to defaults)
            const doc: Record<string, any> = {};
            rawHeaders.forEach((actualHeader, i) => {
              if (skip?.[actualHeader]) return; // skip by exact header text if provided
              const fieldName = resolveFieldName(actualHeader);
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
            if (p) or.push({ normalizedPhone: p }, { phoneLast10: p.slice(-10) });
            if (e) or.push({ Email: e }, { email: e });

            const filter = { userEmail, ...(or.length ? { $or: or } : {}) };
            const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();

            if (!existing) {
              doc.folderId = targetFolderId;
              // also mirror identity fields the rest of the app expects
              doc.Phone = String(doc.phone ?? doc.Phone ?? "");
              doc.phoneLast10 = p ? p.slice(-10) : undefined;
              doc.Email = e || undefined;
              doc.status = doc.status || "New";

              if (!dryRun) {
                const created = await Lead.create(doc);
                newLeadIds.push(created._id as mongoose.Types.ObjectId);
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
                      Phone: String(doc.phone ?? doc.Phone ?? ""),
                      phoneLast10: p ? p.slice(-10) : undefined,
                      Email: e || undefined,
                      updatedAt: new Date(),
                    },
                  }
                );
              }
              updated++;
            }
          }
        }

        // Save pointer best-effort (last processed -> next row index, 1-based)
        const newLast = Math.max(lastProcessed + 1, Number(pointer));
        if (!dryRun) {
          await User.updateOne(
            {
              email: userEmail,
              $or: [
                { "googleSheets.syncedSheets.spreadsheetId": spreadsheetId, "googleSheets.syncedSheets.title": cfg.title ?? title },
                { "googleSheets.sheets.sheetId": spreadsheetId, "googleSheets.sheets.sheetName": cfg.title ?? title },
              ],
            },
            {
              $set: {
                "googleSheets.syncedSheets.$[m].lastRowImported": newLast,
                "googleSheets.syncedSheets.$[m].lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$[m].folderId": targetFolderId,
                "googleSheets.syncedSheets.$[m].folderName": folderDoc.name,
                ...(typeof sheetId === "number" ? { "googleSheets.syncedSheets.$[m].sheetId": sheetId } : {}),
              },
              arrayFilters: [
                { "m.spreadsheetId": spreadsheetId },
              ],
            }
          ).catch(() => {/* ignore if user only has legacy array */});

          // legacy pointer write (best-effort)
          await User.updateOne(
            {
              email: userEmail,
              "googleSheets.sheets.sheetId": spreadsheetId,
            },
            {
              $set: {
                "googleSheets.sheets.$.folderId": targetFolderId,
              },
            }
          ).catch(() => {});
        }

        // Auto-enroll only the newly created leads into active drips for that folder
        if (!dryRun && newLeadIds.length) {
          try {
            await autoEnrollNewLeads({
              userEmail,
              folderId: targetFolderId,
              leadIds: newLeadIds,
              source: "sheet-bulk",
            });
          } catch (e) {
            console.warn("google-sheets-poll: autoEnroll warning", (e as any)?.message || e);
          }
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
          detail.mappingProvided = mapping;
          detail.mappingDefaulted = defaultMap;
          detail.folderResolved = { id: String(targetFolderId), name: folderDoc.name };
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

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";
import { autoEnrollNewLeads } from "@/lib/mongo/leads";

const BUILD_TAG = "poll-canonlock-v5"; // <-- visible in response/header

// --- helpers -------------------------------------------------------------
const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => String(v ?? "").trim().toLowerCase();
const normHeader = (s: any) =>
  String(s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");

const SYSTEM_FOLDERS = new Set(["Sold", "Not Interested", "Booked Appointment", "No Show"]);

type NewCfg = {
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

type LegacyCfg = {
  sheetId: string;   // legacy: spreadsheetId
  sheetName: string; // legacy: tab title
  folderId?: string;
  folderName?: string;
};

type AnyCfg = Partial<NewCfg & LegacyCfg>;

function resolveCfg(raw: AnyCfg): NewCfg | null {
  const spreadsheetId =
    typeof raw.spreadsheetId === "string" && raw.spreadsheetId
      ? raw.spreadsheetId
      : typeof raw.sheetId === "string" && raw.sheetId
      ? (raw.sheetId as string)
      : undefined;

  const title =
    typeof raw.title === "string" && raw.title
      ? raw.title
      : typeof (raw as any).sheetName === "string" && (raw as any).sheetName
      ? (raw as any).sheetName
      : undefined;

  if (!spreadsheetId || !title) return null;

  return {
    spreadsheetId,
    title,
    sheetId: typeof raw.sheetId === "number" ? (raw.sheetId as number) : undefined,
    headerRow: (raw.headerRow as number) ?? 1,
    mapping: (raw.mapping as Record<string, string>) || {},
    skip: (raw.skip as Record<string, boolean>) || {},
    folderId: raw.folderId as string | undefined,
    folderName: raw.folderName as string | undefined,
    lastRowImported: raw.lastRowImported as number | undefined,
  };
}

// ------------------------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("x-poll-version", BUILD_TAG);

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", buildTag: BUILD_TAG });
  }

  // auth
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken = typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  if ((headerToken || queryToken) !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized", buildTag: BUILD_TAG });
  }

  // filters
  const onlyUserEmail =
    typeof req.query.userEmail === "string" ? (req.query.userEmail as string).toLowerCase() : undefined;
  const onlySpreadsheetId =
    typeof req.query.spreadsheetId === "string" ? (req.query.spreadsheetId as string) : undefined;
  const onlyTitle = typeof req.query.title === "string" ? (req.query.title as string) : undefined;
  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const debug = req.query.debug === "1" || req.query.debug === "true";

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

    const detailsAll: any[] = [];

    for (const user of users) {
      const userEmail = String((user as any).email || "").toLowerCase();

      const gs: any = (user as any).googleSheets || {};
      const legacyTok: any = (user as any).googleTokens || {};
      const tok = gs?.refreshToken ? gs : legacyTok?.refreshToken ? legacyTok : null;
      if (!tok?.refreshToken) {
        detailsAll.push({ userEmail, note: "No Google refresh token", buildTag: BUILD_TAG });
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

      const rawCfgs: AnyCfg[] = [
        ...(Array.isArray(gs.syncedSheets) ? gs.syncedSheets : []),
        ...(Array.isArray(gs.sheets) ? gs.sheets : []),
      ];

      if (!rawCfgs.length) {
        detailsAll.push({ userEmail, note: "No linked sheets", buildTag: BUILD_TAG });
        continue;
      }

      for (const raw of rawCfgs) {
        const cfg = resolveCfg(raw);
        if (!cfg) continue;

        if (onlySpreadsheetId && cfg.spreadsheetId !== onlySpreadsheetId) continue;
        if (onlyTitle && cfg.title && cfg.title !== onlyTitle) continue;

        let {
          spreadsheetId,
          title,
          sheetId,
          headerRow = 1,
          mapping = {},
          skip = {},
          lastRowImported,
        } = cfg;

        // Resolve tab title if numeric id present (tabs can be renamed)
        if (typeof sheetId === "number") {
          try {
            const meta = await sheetsApi.spreadsheets.get({
              spreadsheetId,
              fields: "sheets(properties(sheetId,title))",
            });
            const found = (meta.data.sheets || []).find(s => s.properties?.sheetId === sheetId);
            if (found?.properties?.title) title = found.properties.title;
          } catch { /* ignore */ }
        }
        if (!title) continue;

        // ---------- HARD CANONICAL LOCK ----------
        // Always derive canonical from Drive spreadsheet name + tab title.
        const gmeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
        const canonicalName = `Google Sheet — ${gmeta.data.name || "Imported Leads"} — ${title}`;
        const safeName = SYSTEM_FOLDERS.has(canonicalName) ? `${canonicalName} (auto)` : canonicalName;

        const folderDoc = await Folder.findOneAndUpdate(
          { userEmail, name: safeName },
          { $setOnInsert: { userEmail, name: safeName, source: "google-sheets" } },
          { new: true, upsert: true }
        )
          .select("_id name")
          .lean<{ _id: mongoose.Types.ObjectId; name: string } | null>();

        if (!folderDoc) throw new Error("Failed to create/load canonical folder");
        if (SYSTEM_FOLDERS.has(folderDoc.name)) {
          // absolute stop: never write into system buckets
          throw new Error(`Refusing to write into system folder: ${folderDoc.name}`);
        }

        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;

        // Pull rows
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) => String(h ?? "").trim());

        // tolerant header map
        const headerNormToActual = new Map<string, string>();
        rawHeaders.forEach((h) => headerNormToActual.set(normHeader(h), h));

        // default soft mapping
        const defaultMap: Record<string, string> = {};
        for (const [norm, actual] of headerNormToActual.entries()) {
          if (!norm) continue;
          if (["first name", "firstname"].includes(norm)) defaultMap[actual] = "First Name";
          else if (["last name", "lastname"].includes(norm)) defaultMap[actual] = "Last Name";
          else if (["phone", "phone number", "phonenumber", "phone1"].includes(norm)) defaultMap[actual] = "phone";
          else if (["email", "e-mail"].includes(norm)) defaultMap[actual] = "email";
          else if (["state"].includes(norm)) defaultMap[actual] = "State";
          else if (["notes", "note"].includes(norm)) defaultMap[actual] = "Notes";
        }

        // explicit mapping normalization (still honored)
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping || {}).forEach(([k, v]) => {
          normalizedMapping[normHeader(k)] = v;
        });
        const resolveFieldName = (actualHeader: string): string | undefined =>
          normalizedMapping[normHeader(actualHeader)] || defaultMap[actualHeader];

        // window based on pointer
        const pointer = typeof lastRowImported === "number" ? lastRowImported : headerRow;
        const firstDataZero = headerIdx + 1;
        let startIndex = Math.max(firstDataZero, Number(pointer));
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

            const doc: Record<string, any> = {};
            rawHeaders.forEach((actualHeader, i) => {
              if ((cfg.skip as any)?.[actualHeader]) return;
              const field = resolveFieldName(actualHeader);
              if (!field) return;
              doc[field] = row[i] ?? "";
            });

            const p = normPhone(doc.phone ?? doc.Phone);
            const e = normEmail(doc.email ?? doc.Email);
            if (!p && !e) { skippedNoKey++; continue; }

            doc.Phone = String(doc.phone ?? doc.Phone ?? "");
            doc.phoneLast10 = p ? p.slice(-10) : undefined;
            if (e) { doc.email = e; doc.Email = e; }
            doc.normalizedPhone = p || undefined;

            doc.userEmail = userEmail;
            doc.source = "google-sheets";
            doc.sourceSpreadsheetId = spreadsheetId;
            doc.sourceTabTitle = title;
            doc.sourceRowIndex = r + 1;
            doc.folderId = targetFolderId;

            const or: any[] = [];
            if (p) or.push({ normalizedPhone: p }, { phoneLast10: p.slice(-10) });
            if (e) or.push({ Email: e }, { email: e });

            const filter = { userEmail, ...(or.length ? { $or: or } : {}) };

            const existing = await Lead.findOne(filter).select("_id folderId").lean<{ _id: mongoose.Types.ObjectId, folderId?: mongoose.Types.ObjectId } | null>();
            if (!existing) {
              if (!dryRun) {
                const createdLead = await Lead.create(doc);
                newLeadIds.push(createdLead._id as mongoose.Types.ObjectId);
              }
              imported++;
            } else {
              if (!dryRun) {
                let $set: any = { ...doc, updatedAt: new Date() };
                if (existing.folderId) {
                  try {
                    const f = await Folder.findById(existing.folderId).select("name").lean<{ name?: string } | null>();
                    if (f?.name && SYSTEM_FOLDERS.has(f.name)) {
                      $set.folderId = targetFolderId; // pull out of system bucket
                    }
                  } catch { /* ignore */ }
                } else {
                  $set.folderId = targetFolderId;
                }
                await Lead.updateOne({ _id: existing._id }, { $set });
              }
              updated++;
            }
          }
        }

        const newLast = Math.max(lastProcessed + 1, Number(pointer));

        if (!dryRun) {
          await User.updateOne(
            { email: userEmail },
            {
              $set: {
                "googleSheets.syncedSheets.$[x].lastRowImported": newLast,
                "googleSheets.syncedSheets.$[x].lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$[x].folderId": targetFolderId,
                "googleSheets.syncedSheets.$[x].folderName": folderDoc.name,
                "googleSheets.sheets.$[y].lastRowImported": newLast,
                "googleSheets.sheets.$[y].lastImportedAt": new Date(),
                "googleSheets.sheets.$[y].folderId": targetFolderId,
                "googleSheets.sheets.$[y].folderName": folderDoc.name,
              },
            },
            {
              arrayFilters: [
                { "x.spreadsheetId": spreadsheetId, "x.title": title },
                { "y.sheetId": spreadsheetId },
              ],
            }
          );
        }

        if (!dryRun && newLeadIds.length) {
          try {
            await autoEnrollNewLeads({
              userEmail,
              folderId: targetFolderId,
              leadIds: newLeadIds,
              source: "sheet-bulk",
            });
          } catch (e: any) {
            console.warn("autoEnroll warning:", e?.message || e);
          }
        }

        const detail: any = {
          buildTag: BUILD_TAG,
          userEmail,
          spreadsheetId,
          title,
          imported,
          updated,
          skippedNoKey,
          headerRow,
          startIndex,
          endIndex,
          rowCount: values.length,
          newLastRowImported: newLast,
          dryRun,
          folderId: String(targetFolderId),
          folderName: folderDoc.name,
          canonicalName: safeName
        };
        if (debug) {
          detail.headers = rawHeaders;
        }
        detailsAll.push(detail);
      }
    }

    if (debug) console.log("Sheets poll (debug)", BUILD_TAG, JSON.stringify(detailsAll, null, 2));
    return res.status(200).json({ ok: true, buildTag: BUILD_TAG, details: detailsAll });
  } catch (err: any) {
    console.error("Sheets poll error", BUILD_TAG, err);
    return res.status(500).json({ error: err?.message || "Cron poll failed", buildTag: BUILD_TAG });
  }
}

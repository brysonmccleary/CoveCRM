import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

/**
 * Build fingerprint for tracing.
 * v5g
 * - Hardened non-system folder resolution (never returns a system folder)
 * - TS-safe casts on .lean() results
 * - Legacy shape support (googleSheets.sheets)
 * - Title/sheetId reconciliation + header/mapping normalization
 * - Pointer write-back and folderId/folderName persistence
 */
const FP = "selfheal-v5g";

// --- Small helpers -----------------------------------------------------------

const normHeader = (s: any) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

const normEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};

const onlyDigits = (v: any) => String(v ?? "").replace(/\D+/g, "");

/** Choose a safe folder name if an input is a system folder label. */
function toSafeName(name: string) {
  const base = String(name || "").trim();
  if (!base) return "Imported Leads";
  return isSystemFolder(base) ? `${base} (Leads)` : base;
}

/** Upsert a folder by name, ensuring non-system name. Returns the doc (lean). */
async function upsertFolderByName(
  userEmail: string,
  name: string,
  source = "google-sheets"
) {
  const safe = toSafeName(name);
  const doc = (await Folder.findOneAndUpdate(
    { userEmail, name: safe },
    { $setOnInsert: { userEmail, name: safe, source } },
    { new: true, upsert: true }
  ).lean()) as any;
  return doc as { _id: mongoose.Types.ObjectId; name: string; userEmail: string } | null;
}

/**
 * Resolve a non-system folder for this sheet run.
 * Priority:
 *  1) If cfg has folderId and it’s a non-system folder that belongs to user -> use it
 *  2) If cfg has folderName -> upsert that non-system name
 *  3) Default: "<Drive File Name> — <Tab Title>" (non-system enforced)
 */
async function getFolderSafe(opts: {
  userEmail: string;
  cfgFolderId?: any;
  cfgFolderName?: string | null;
  defaultName: string;
}) {
  const { userEmail, cfgFolderId, cfgFolderName, defaultName } = opts;

  // 1) Existing folderId preference (validate + ensure non-system)
  if (cfgFolderId && mongoose.isValidObjectId(cfgFolderId)) {
    const current = (await Folder.findOne({
      _id: new mongoose.Types.ObjectId(cfgFolderId),
      userEmail,
    })
      .select({ _id: 1, name: 1, userEmail: 1 })
      .lean()) as any;
    if (current && current.name && !isSystemFolder(current.name)) {
      return current as { _id: mongoose.Types.ObjectId; name: string; userEmail: string };
    }
  }

  // 2) Named preference
  if (cfgFolderName && String(cfgFolderName).trim()) {
    const byName = await upsertFolderByName(userEmail, cfgFolderName);
    if (byName && byName.name && !isSystemFolder(byName.name)) return byName;
  }

  // 3) Default
  const fallback = await upsertFolderByName(userEmail, defaultName);
  if (fallback && fallback.name && !isSystemFolder(fallback.name)) return fallback;

  // 3b) Absolute last-resort with timestamp to guarantee uniqueness & non-system
  const final = await upsertFolderByName(userEmail, `${toSafeName(defaultName)} — ${Date.now()}`);
  return final!;
}

type SyncedCfg = {
  spreadsheetId: string;
  title?: string;
  sheetId?: number;
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
  lastRowImported?: number;
  folderId?: any;
  folderName?: string;
};

function isTruthy(v: any) {
  return ["1", "true", "yes"].includes(String(v).toLowerCase());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed", fingerprint: FP });
  }

  // --- Auth via header or query token
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken = typeof req.query.token === "string" ? (req.query.token as string) : undefined;
  const provided = headerToken || queryToken;
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized", fingerprint: FP });
  }

  // --- Optional filters
  const onlyUserEmail =
    typeof req.query.userEmail === "string" ? (req.query.userEmail as string).toLowerCase() : undefined;
  const onlySpreadsheetId =
    typeof req.query.spreadsheetId === "string" ? (req.query.spreadsheetId as string) : undefined;
  const onlyTitle = typeof req.query.title === "string" ? (req.query.title as string) : undefined;

  const dryRun = isTruthy(req.query.dryRun);
  const debug = isTruthy(req.query.debug);

  // --- Limits
  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();

    // Pull both new + legacy shapes
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
        detailsAll.push({ userEmail, note: "No Google refresh token", fingerprint: FP });
        continue;
      }

      // Google auth
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

      // Current configs (new or legacy)
      const rawConfigs: any[] =
        (gs?.syncedSheets && Array.isArray(gs.syncedSheets) && gs.syncedSheets.length
          ? gs.syncedSheets
          : (gs?.sheets && Array.isArray(gs.sheets) ? gs.sheets : [])) as any[];

      if (!rawConfigs?.length) {
        detailsAll.push({ userEmail, note: "No syncedSheets/sheets", fingerprint: FP });
        continue;
      }

      for (const cfgAny of rawConfigs) {
        // Normalize the config record
        const cfg: SyncedCfg = { ...(cfgAny || {}) };

        // legacy alias: some used "sheetId" (string) for spreadsheetId
        if (!cfg.spreadsheetId && typeof (cfgAny as any)?.sheetId === "string" && (cfgAny as any).sheetId.length > 12) {
          cfg.spreadsheetId = (cfgAny as any).sheetId;
          cfg.sheetId = typeof (cfgAny as any)?.tabId === "number" ? Number((cfgAny as any).tabId) : cfg.sheetId;
        }

        if (!cfg.spreadsheetId) continue;
        if (onlySpreadsheetId && cfg.spreadsheetId !== onlySpreadsheetId) continue;

        let title = cfg.title || "";
        const headerRow = Math.max(1, Number(cfg.headerRow || 1));
        const mapping = (cfg.mapping || {}) as Record<string, string>;
        const skip = (cfg.skip || {}) as Record<string, boolean>;
        const lastRowImported = typeof cfg.lastRowImported === "number" ? cfg.lastRowImported : undefined;

        // Resolve title via sheetId if provided
        if (!title && cfg.sheetId != null) {
          try {
            const meta = await sheetsApi.spreadsheets.get({
              spreadsheetId: cfg.spreadsheetId,
              fields: "sheets(properties(sheetId,title))",
            });
            const found = (meta.data.sheets || []).find((s) => s.properties?.sheetId === cfg.sheetId);
            if (found?.properties?.title) title = found.properties.title;
          } catch {
            // ignore
          }
        }
        if (!title) title = "Sheet1";
        if (onlyTitle && title !== onlyTitle) continue;

        // Determine default target folder name based on Drive name + tab title
        const driveMeta = await drive.files.get({
          fileId: cfg.spreadsheetId,
          fields: "name",
        });
        const defaultFolderName = `${driveMeta.data.name || "Imported Leads"} — ${title}`;

        // Resolve/create a non-system folder
        const folderDoc = await getFolderSafe({
          userEmail,
          cfgFolderId: cfg.folderId,
          cfgFolderName: cfg.folderName,
          defaultName: defaultFolderName,
        });

        // Persist chosen folder back to *both* shapes (best-effort), plus title and sheetId if known.
        if (!dryRun) {
          const sets: any = {
            ...(title ? { "googleSheets.syncedSheets.$[t].title": title } : {}),
            "googleSheets.syncedSheets.$[t].folderId": folderDoc._id,
            "googleSheets.syncedSheets.$[t].folderName": folderDoc.name,
          };
          if (cfg.sheetId != null) sets["googleSheets.syncedSheets.$[t].sheetId"] = cfg.sheetId;

          await User.updateOne(
            { email: userEmail },
            { $set: sets },
            { arrayFilters: [{ "t.spreadsheetId": cfg.spreadsheetId }] }
          ).catch(() => { /* ignore if no match */ });

          // legacy
          await User.updateOne(
            { email: userEmail, "googleSheets.sheets.sheetId": cfg.spreadsheetId },
            {
              $set: {
                "googleSheets.sheets.$.folderId": folderDoc._id,
                "googleSheets.sheets.$.folderName": folderDoc.name,
              },
            }
          ).catch(() => { /* ignore if not legacy */ });
        }

        // --- Read values for this tab
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId: cfg.spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });

        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const rawHeaders = (values[headerIdx] || []).map((h) => String(h ?? "").trim());

        // Normalize mapping
        const normalizedMapping: Record<string, string> = {};
        Object.entries(mapping as Record<string, unknown>).forEach(([key, val]) => {
          if (typeof val === "string" && val) {
            normalizedMapping[normHeader(key)] = val;
          }
        });

        // Figure out starting row pointer
        const pointer = typeof lastRowImported === "number" ? lastRowImported : headerRow;
        const firstDataZero = headerIdx + 1; // index of 1st data row (0-based)
        let startIndex = Math.max(firstDataZero, Number(pointer));
        if (startIndex > values.length - 1) startIndex = firstDataZero;
        const endIndex = Math.min(values.length - 1, startIndex + MAX_ROWS_PER_SHEET - 1);

        // Counters
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
              if (skip && skip[actualHeader]) return;
              const fieldName = normalizedMapping[n];
              if (!fieldName) return;
              doc[fieldName] = row[i] ?? "";
            });

            // Normalize keys
            const phoneRaw = doc.phone ?? (doc as any).Phone;
            const pDigits = onlyDigits(phoneRaw);
            const e = normEmail(doc.email ?? (doc as any).Email);

            if (!pDigits && !e) {
              skippedNoKey++;
              continue;
            }

            // finalize doc
            doc.userEmail = userEmail;
            doc.source = "google-sheets";
            doc.sourceSpreadsheetId = cfg.spreadsheetId;
            doc.sourceTabTitle = title;
            doc.sourceRowIndex = r + 1;
            if (pDigits) {
              doc.normalizedPhone = pDigits;
              // also keep Phone field if mapping used it
              if (!doc.Phone && phoneRaw) doc.Phone = String(phoneRaw);
            }
            if (e) {
              doc.email = e;
              if (!doc.Email) doc.Email = e;
            }

            // match existing by normalized phone or email
            const or: any[] = [];
            if (pDigits) or.push({ normalizedPhone: pDigits });
            if (e) or.push({ email: e });

            const filter = { userEmail, ...(or.length ? { $or: or } : {}) };
            const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();

            if (!existing) {
              if (!dryRun) {
                await Lead.create({
                  ...doc,
                  folderId: folderDoc._id,
                  folder_name: folderDoc.name,
                  ["Folder Name"]: folderDoc.name,
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
                      folderId: folderDoc._id,
                      folder_name: folderDoc.name,
                      ["Folder Name"]: folderDoc.name,
                    },
                  }
                );
              }
              updated++;
            }
          }
        }

        // Pointer write-back
        const newLast = Math.max(lastProcessed + 1, Number(pointer));
        if (!dryRun) {
          // new shape
          await User.updateOne(
            { email: userEmail, "googleSheets.syncedSheets.spreadsheetId": cfg.spreadsheetId },
            {
              $set: {
                "googleSheets.syncedSheets.$.lastRowImported": newLast,
                "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$.folderId": folderDoc._id,
                "googleSheets.syncedSheets.$.folderName": folderDoc.name,
              },
            }
          ).catch(() => {});

          // legacy shape
          await User.updateOne(
            { email: userEmail, "googleSheets.sheets.sheetId": cfg.spreadsheetId },
            {
              $set: {
                "googleSheets.sheets.$.lastRowImported": newLast,
                "googleSheets.sheets.$.lastImportedAt": new Date(),
                "googleSheets.sheets.$.folderId": folderDoc._id,
                "googleSheets.sheets.$.folderName": folderDoc.name,
              },
            }
          ).catch(() => {});
        }

        detailsAll.push({
          userEmail,
          spreadsheetId: cfg.spreadsheetId,
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
            id: String(folderDoc._id),
            name: String(folderDoc.name),
            isSystem: isSystemFolder(String(folderDoc.name)),
          },
          ...(debug
            ? {
                diag: {
                  defaultFolderName,
                  cfgFolderId: cfg.folderId ?? null,
                  cfgFolderName: cfg.folderName ?? null,
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
      fingerprint: FP,
    });
  } catch (err: any) {
    console.error("Sheets poll error:", err);
    return res.status(500).json({ error: err?.message || "Cron poll failed", fingerprint: FP });
  }
}

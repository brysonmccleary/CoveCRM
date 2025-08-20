// /pages/api/cron/google-sheets-poll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";

function normalizePhone(input: any) {
  return String(input || "").replace(/\D+/g, "");
}
function normalizeEmail(input: any) {
  const s = String(input || "").trim();
  return s ? s.toLowerCase() : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Token check: header x-cron-secret or ?token= must match env
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : (req.headers["x-cron-secret"] as string | undefined);
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const provided = headerToken || queryToken;
  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Debug helpers via query:
  const onlyUserEmail = typeof req.query.userEmail === "string" ? req.query.userEmail.toLowerCase() : undefined;
  const onlySpreadsheetId = typeof req.query.spreadsheetId === "string" ? req.query.spreadsheetId : undefined;
  const onlyTab = typeof req.query.title === "string" ? req.query.title : undefined;
  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();

    // Include back-compat users who still store tokens in googleTokens
    const userFilter: any = {
      $and: [
        { "googleSheets.syncedSheets.0": { $exists: true } }, // mapping saved
        onlyUserEmail ? { email: onlyUserEmail } : {},        // optional filter
      ].filter(Boolean),
    };

    const users = await User.find(userFilter).limit(MAX_USERS).lean();
    const detailsAll: any[] = [];

    for (const user of users) {
      const userEmail = String((user as any).email || "").toLowerCase();

      // Pick tokens from googleSheets or fallback googleTokens
      const gs: any = (user as any).googleSheets || {};
      const legacy: any = (user as any).googleTokens || {};
      const tok = gs?.refreshToken ? gs : legacy?.refreshToken ? legacy : null;
      if (!tok?.refreshToken) {
        detailsAll.push({ userEmail, note: "No refresh token on user" });
        continue;
      }

      // OAuth client
      const redirectBase =
        process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID!,
        process.env.GOOGLE_CLIENT_SECRET!,
        `${redirectBase}/api/connect/google-sheets/callback`
      );
      oauth2.setCredentials({
        access_token: tok.accessToken,
        refresh_token: tok.refreshToken,
        expiry_date: tok.expiryDate,
      });

      const drive = google.drive({ version: "v3", auth: oauth2 });
      const sheetsApi = google.sheets({ version: "v4", auth: oauth2 });

      const syncedSheets: any[] = (user as any)?.googleSheets?.syncedSheets || [];
      if (!Array.isArray(syncedSheets) || syncedSheets.length === 0) {
        detailsAll.push({ userEmail, note: "No syncedSheets configured" });
        continue;
      }

      for (const sheetCfg of syncedSheets) {
        const {
          spreadsheetId,
          title,
          headerRow = 1,
          mapping = {},
          skip = {},
          lastRowImported, // 1-based index of the LAST imported row
          folderId,
          folderName,
        } = sheetCfg || {};

        if (!spreadsheetId || !title) continue;
        if (onlySpreadsheetId && spreadsheetId !== onlySpreadsheetId) continue;
        if (onlyTab && title !== onlyTab) continue;

        // Pointer default: if undefined, start at header row (nothing imported yet)
        const pointer = typeof lastRowImported === "number" ? lastRowImported : headerRow;

        // Ensure folder exists
        let folderDoc: any = null;
        if (folderId) {
          try {
            folderDoc = await Folder.findOne({ _id: new mongoose.Types.ObjectId(folderId) });
          } catch {
            // ignore invalid id
          }
        }
        if (!folderDoc) {
          const meta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
          const defaultName = folderName || `${meta.data.name || "Imported Leads"} — ${title}`;
          folderDoc = await Folder.findOneAndUpdate(
            { userEmail, name: defaultName },
            { $setOnInsert: { userEmail, name: defaultName, source: "google-sheets" } },
            { new: true, upsert: true }
          );
        }
        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;

        // Fetch current values
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());

        // Compute start/end
        const firstDataZero = headerIdx + 1; // first row after headers (0-based)
        // pointer is 1-based LAST imported row; next row to process (0-based) is max(firstDataZero, pointer)
        const startIndex = Math.max(firstDataZero, Number(pointer));
        const endIndex = Math.min(values.length - 1, startIndex + MAX_ROWS_PER_SHEET - 1);

        let imported = 0;
        let updated = 0;
        let skippedNoKey = 0;
        let lastProcessed = Number(pointer) - 1; // keep 0-based internal

        if (startIndex <= endIndex) {
          for (let r = startIndex; r <= endIndex; r++) {
            const row = values[r] || [];
            const hasAny = row.some((c) => String(c || "").trim() !== "");
            if (!hasAny) continue;

            lastProcessed = r;

            const doc: Record<string, any> = {};
            headers.forEach((h, i) => {
              if (!h) return;
              if (skip[h]) return;
              const fieldName = mapping[h];
              if (!fieldName) return;
              doc[fieldName] = row[i] ?? "";
            });

            const normalizedPhone = normalizePhone(doc.phone ?? doc.Phone ?? "");
            const emailLower = normalizeEmail(doc.email ?? doc.Email ?? "");
            if (!normalizedPhone && !emailLower) {
              skippedNoKey++;
              continue;
            }

            doc.userEmail = userEmail;
            doc.source = "google-sheets";
            doc.sourceSpreadsheetId = spreadsheetId;
            doc.sourceTabTitle = title;
            doc.sourceRowIndex = r + 1; // 1-based
            doc.normalizedPhone = normalizedPhone || undefined;
            if (emailLower) doc.email = emailLower;

            const or: any[] = [];
            if (normalizedPhone) or.push({ normalizedPhone });
            if (emailLower) or.push({ email: emailLower });
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

        // Update pointer (1-based last processed row)
        const newLast = Math.max(lastProcessed + 1, Number(pointer));
        if (!dryRun) {
          await User.updateOne(
            {
              email: userEmail,
              "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
              "googleSheets.syncedSheets.title": title,
            },
            {
              $set: {
                "googleSheets.syncedSheets.$.lastRowImported": newLast,
                "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
                "googleSheets.syncedSheets.$.folderId": targetFolderId,
                "googleSheets.syncedSheets.$.folderName": folderDoc.name,
              },
            }
          );
        }

        detailsAll.push({
          userEmail,
          spreadsheetId,
          title,
          headerRow,
          pointerWas: pointer,
          startIndex,
          endIndex,
          imported,
          updated,
          skippedNoKey,
          newLastRowImported: newLast,
          dryRun,
        });
      }
    }

    // Helpful console log for Vercel Functions tab
    console.log("Sheets poll summary:", JSON.stringify(detailsAll, null, 2));

    return res.status(200).json({ ok: true, processedUsers: users.length, details: detailsAll });
  } catch (err: any) {
    console.error("Sheets poll error:", err);
    return res.status(500).json({ error: err?.message || "Cron poll failed" });
  }
}

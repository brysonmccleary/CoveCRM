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

  // Token check: header or ?token= must match CRON_SECRET
  const headerToken = Array.isArray(req.headers["x-cron-secret"])
    ? req.headers["x-cron-secret"][0]
    : req.headers["x-cron-secret"];
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  const provided = headerToken || queryToken;

  if (provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const MAX_USERS = Number(process.env.POLL_MAX_USERS || 10);
  const MAX_ROWS_PER_SHEET = Number(process.env.POLL_MAX_ROWS || 500);

  try {
    await dbConnect();

    const users = await User.find({
      "googleSheets.refreshToken": { $exists: true, $ne: "" },
      "googleSheets.syncedSheets.0": { $exists: true },
    })
      .limit(MAX_USERS)
      .lean();

    const detailsAll: any[] = [];

    for (const user of users) {
      const userEmail = String((user as any).email || "").toLowerCase();
      const gs: any = (user as any).googleSheets;
      if (!userEmail || !gs?.refreshToken) continue;

      const redirectBase =
        process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
      const oauth2 = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID!,
        process.env.GOOGLE_CLIENT_SECRET!,
        `${redirectBase}/api/connect/google-sheets/callback`
      );
      oauth2.setCredentials({
        access_token: gs.accessToken,
        refresh_token: gs.refreshToken,
        expiry_date: gs.expiryDate,
      });

      const drive = google.drive({ version: "v3", auth: oauth2 });
      const sheetsApi = google.sheets({ version: "v4", auth: oauth2 });

      for (const sheetCfg of gs.syncedSheets || []) {
        const {
          spreadsheetId,
          title,
          headerRow = 1,
          mapping = {},
          skip = {},
          lastRowImported = headerRow, // 1-based index of the LAST imported row
          folderId,
          folderName,
        } = sheetCfg || {};

        if (!spreadsheetId || !title) continue;

        // Ensure folder exists (re-use if present)
        let folderDoc: any = null;
        if (folderId) {
          try {
            folderDoc = await Folder.findOne({
              _id: new mongoose.Types.ObjectId(folderId),
            });
          } catch {
            // ignore invalid ObjectId
          }
        }
        if (!folderDoc) {
          const meta = await drive.files.get({
            fileId: spreadsheetId,
            fields: "name",
          });
          const defaultName =
            folderName || `${meta.data.name || "Imported Leads"} — ${title}`;
          folderDoc = await Folder.findOneAndUpdate(
            { userEmail, name: defaultName },
            { $setOnInsert: { userEmail, name: defaultName, source: "google-sheets" } },
            { new: true, upsert: true }
          );
        }
        const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;

        // Pull sheet values
        const resp = await sheetsApi.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A1:ZZ`,
          majorDimension: "ROWS",
        });
        const values = (resp.data.values || []) as string[][];
        const headerIdx = Math.max(0, headerRow - 1);
        const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());

        // lastRowImported is 1-based index of the LAST imported row.
        // We want to start at the NEXT row (0-based) => start = lastRowImported (1-based next) - 0? No:
        // Convert pointer to 0-based start index for iteration:
        // Next row to process (1-based) = lastRowImported + 1
        // 0-based index = (lastRowImported + 1) - 1 = lastRowImported
        // But we must also respect header row:
        const firstDataZero = headerIdx + 1;
        const startIndex = Math.max(firstDataZero, Number(lastRowImported)); // <-- 0-based index to begin
        const endIndex = Math.min(values.length - 1, startIndex + MAX_ROWS_PER_SHEET - 1);

        let imported = 0;
        let updated = 0;
        let skippedNoKey = 0;
        let lastProcessed = Number(lastRowImported) - 1; // keep as 0-based last processed

        for (let r = startIndex; r <= endIndex; r++) {
          const row = values[r] || [];
          if (!row.some((c) => String(c || "").trim() !== "")) continue;
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

          const existing = await Lead.findOne(filter)
            .select("_id")
            .lean<{ _id: mongoose.Types.ObjectId } | null>();

          if (!existing) {
            doc.folderId = targetFolderId;
            await Lead.create(doc);
            imported++;
          } else {
            await Lead.updateOne(
              { _id: existing._id },
              { $set: { ...doc, folderId: targetFolderId } }
            );
            updated++;
          }
        }

        // Store back pointer as 1-based index of the LAST imported row
        const newLast = Math.max(lastProcessed + 1, Number(lastRowImported));
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

        detailsAll.push({
          userEmail,
          spreadsheetId,
          title,
          startIndex,
          endIndex,
          imported,
          updated,
          skippedNoKey,
          newLastRowImported: newLast,
        });
      }
    }

    return res.status(200).json({
      ok: true,
      processedUsers: users.length,
      details: detailsAll,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Cron poll failed" });
  }
}

// /pages/api/google/sheets/poll.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";

function normalizePhone(input: any): string {
  return String(input || "").replace(/\D+/g, "");
}
function normalizeEmail(input: any): string {
  const s = String(input || "").trim();
  return s ? s.toLowerCase() : "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = session.user.email.toLowerCase();

  const MAX_ROWS_PER_SHEET = 500;

  try {
    await dbConnect();
    const user = await User.findOne({ email: userEmail }).lean();
    const gs = (user as any)?.googleSheets;
    if (!gs?.refreshToken) return res.status(400).json({ error: "Google not connected" });

    const syncedSheets: any[] = (user as any)?.googleSheets?.syncedSheets || [];
    if (!syncedSheets.length) return res.status(200).json({ ok: true, polled: 0, details: [] });

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI_SHEETS ||
      `${base}/api/connect/google-sheets/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );
    oauth2.setCredentials({
      access_token: gs.accessToken,
      refresh_token: gs.refreshToken,
      expiry_date: gs.expiryDate,
    });

    const drive = google.drive({ version: "v3", auth: oauth2 });
    const sheetsApi = google.sheets({ version: "v4", auth: oauth2 });

    const details: any[] = [];

    for (const sheetCfg of syncedSheets) {
      const {
        spreadsheetId,
        title,
        headerRow = 1,
        mapping = {},
        skip = {},
        lastRowImported = headerRow,
        folderId,
        folderName,
      } = sheetCfg || {};

      if (!spreadsheetId || !title) continue;

      // Ensure folder exists
      let folderDoc: any = null;
      if (folderId) {
        folderDoc = await Folder.findOne({ _id: new mongoose.Types.ObjectId(folderId) });
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

      // Fetch all values
      const resp = await sheetsApi.spreadsheets.values.get({
        spreadsheetId,
        range: `'${title}'!A1:ZZ`,
        majorDimension: "ROWS",
      });
      const values = (resp.data.values || []) as string[][];

      const headerIdx = Math.max(0, headerRow - 1);
      const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());
      const startIndex = Math.max(headerIdx + 1, (lastRowImported as number));
      const endIndex = Math.min(values.length - 1, startIndex + MAX_ROWS_PER_SHEET - 1);

      let imported = 0;
      let updated = 0;
      let skippedNoKey = 0;
      let lastProcessed = (lastRowImported as number) - 1;

      for (let r = startIndex; r <= endIndex; r++) {
        const row = values[r] || [];
        const hasAny = row.some((cell) => String(cell || "").trim() !== "");
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
        doc.sourceRowIndex = r + 1;
        doc.normalizedPhone = normalizedPhone || undefined;
        if (emailLower) doc.email = emailLower;

        const or: any[] = [];
        if (normalizedPhone) or.push({ normalizedPhone });
        if (emailLower) or.push({ email: emailLower });
        const filter = { userEmail, ...(or.length ? { $or: or } : {}) };

        // Fetch only _id for existence check
        const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();

        if (!existing) {
          doc.folderId = targetFolderId;
          await Lead.create(doc);
          imported++;
        } else {
          const update: any = { $set: { ...doc, folderId: targetFolderId } };
          await Lead.updateOne({ _id: existing._id }, update);
          updated++;
        }
      }

      const newLast = Math.max(lastProcessed + 1, lastRowImported);
      const positional = await User.updateOne(
        { email: userEmail, "googleSheets.syncedSheets.spreadsheetId": spreadsheetId, "googleSheets.syncedSheets.title": title },
        {
          $set: {
            "googleSheets.syncedSheets.$.lastRowImported": newLast,
            "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
            "googleSheets.syncedSheets.$.folderId": targetFolderId,
            "googleSheets.syncedSheets.$.folderName": folderDoc.name,
          },
        }
      );

      details.push({
        spreadsheetId,
        title,
        imported,
        updated,
        skippedNoKey,
        fromRow: startIndex + 1,
        toRow: endIndex + 1,
        newLastRowImported: newLast,
      });
    }

    return res.status(200).json({ ok: true, polled: details.length, details });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Poll failed";
    return res.status(500).json({ error: message });
  }
}

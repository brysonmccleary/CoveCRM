// /pages/api/google/sheets/import.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";

type ImportBody = {
  spreadsheetId: string;
  title?: string;           // tab title (preferred)
  sheetId?: number;         // optional alternative to title
  headerRow?: number;       // 1-based index (default 1)
  startRow?: number;        // 1-based data row to start importing (default headerRow+1)
  endRow?: number;          // optional, inclusive
  folderId?: string;        // if provided, we use this folder
  folderName?: string;      // else we create/find by name
  mapping: Record<string, string>;   // header -> fieldName (ignored if empty)
  skip?: Record<string, boolean>;    // header -> true to skip
  createFolderIfMissing?: boolean;   // default true
  moveExistingToFolder?: boolean;    // default true
};

function normalizePhone(input: any): string {
  const digits = String(input || "").replace(/\D+/g, "");
  // keep as raw digits; typical US will be 10 or 11 (with country code)
  return digits;
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

  const {
    spreadsheetId,
    title,
    sheetId,
    headerRow = 1,
    startRow,
    endRow,
    folderId,
    folderName,
    mapping = {},
    skip = {},
    createFolderIfMissing = true,
    moveExistingToFolder = true,
  } = (req.body || {}) as ImportBody;

  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });
  if (!title && typeof sheetId !== "number")
    return res.status(400).json({ error: "Provide sheet 'title' or numeric 'sheetId'" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: userEmail }).lean();
    const gs = (user as any)?.googleSheets;
    if (!gs?.refreshToken) return res.status(400).json({ error: "Google not connected" });

    // OAuth client (reuse redirect used in other routes)
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

    const sheets = google.sheets({ version: "v4", auth: oauth2 });

    // Resolve tab title if only sheetId passed
    let tabTitle = title;
    if (!tabTitle && typeof sheetId === "number") {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });
      const found = (meta.data.sheets || []).find(
        (s) => s.properties?.sheetId === sheetId
      );
      tabTitle = found?.properties?.title || undefined;
      if (!tabTitle) return res.status(400).json({ error: "sheetId not found" });
    }

    // Pull rows (A1:ZZ for simplicity)
    const valueResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabTitle}'!A1:ZZ`,
      majorDimension: "ROWS",
    });
    const values = (valueResp.data.values || []) as string[][];

    if (!values.length) {
      return res.status(200).json({ imported: 0, updated: 0, skippedNoKey: 0, rowCount: 0, lastRowImported: 0, note: "No data in sheet." });
    }

    // headers
    const headerIdx = Math.max(0, headerRow - 1);
    const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());

    // data range
    const firstDataRowIndex = typeof startRow === "number"
      ? Math.max(1, startRow) - 1
      : headerIdx + 1;

    const lastRowIndex = typeof endRow === "number"
      ? Math.min(values.length, Math.max(endRow, firstDataRowIndex + 1)) - 1
      : values.length - 1;

    // Folder (find or create)
    let folderDoc: any = null;
    if (folderId) {
      folderDoc = await Folder.findOne({ _id: new mongoose.Types.ObjectId(folderId) });
    } else if (folderName) {
      folderDoc = await Folder.findOneAndUpdate(
        { userEmail, name: folderName },
        { $setOnInsert: { userEmail, name: folderName, source: "google-sheets" } },
        { new: true, upsert: createFolderIfMissing }
      );
    } else {
      // default folder name: spreadsheet name + tab title
      const meta = await google.drive({ version: "v3", auth: oauth2 }).files.get({
        fileId: spreadsheetId,
        fields: "name",
      });
      const defaultName = `${meta.data.name || "Imported Leads"} — ${tabTitle}`;
      folderDoc = await Folder.findOneAndUpdate(
        { userEmail, name: defaultName },
        { $setOnInsert: { userEmail, name: defaultName, source: "google-sheets" } },
        { new: true, upsert: true }
      );
    }
    if (!folderDoc) return res.status(400).json({ error: "Folder not found/created" });
    const targetFolderId = folderDoc._id as mongoose.Types.ObjectId;

    // Import loop
    let imported = 0;
    let updated = 0;
    let skippedNoKey = 0;
    let lastNonEmptyRow = headerIdx;

    for (let r = firstDataRowIndex; r <= lastRowIndex; r++) {
      const row = values[r] || [];
      const hasAny = row.some((cell) => String(cell || "").trim() !== "");
      if (!hasAny) continue;

      lastNonEmptyRow = r;

      // Build record from mapping
      const doc: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        if (skip[h]) return;
        const fieldName = mapping[h];
        if (!fieldName) return;
        doc[fieldName] = row[i] ?? "";
      });

      // Normalize identity
      const phoneCandidate = doc.phone ?? doc.Phone ?? "";
      const emailCandidate = doc.email ?? doc.Email ?? "";
      const normalizedPhone = normalizePhone(phoneCandidate);
      const emailLower = normalizeEmail(emailCandidate);

      if (!normalizedPhone && !emailLower) {
        skippedNoKey++;
        continue;
      }

      // Enrich base fields
      doc.userEmail = userEmail;
      doc.source = "google-sheets";
      doc.sourceSpreadsheetId = spreadsheetId;
      doc.sourceTabTitle = tabTitle;
      doc.sourceRowIndex = r + 1; // 1-based
      doc.normalizedPhone = normalizedPhone || undefined;
      if (emailLower) doc.email = emailLower;

      // Upsert criteria
      const or: any[] = [];
      if (normalizedPhone) or.push({ normalizedPhone });
      if (emailLower) or.push({ email: emailLower });

      const filter = { userEmail, ...(or.length ? { $or: or } : {}) };

      const existing = await Lead.findOne(filter).lean();
      if (!existing) {
        // create new
        doc.folderId = targetFolderId;
        await Lead.create(doc);
        imported++;
      } else {
        // update existing
        const update: any = { $set: { ...doc } };
        if (moveExistingToFolder) update.$set.folderId = targetFolderId;
        await Lead.updateOne({ _id: existing._id }, update);
        updated++;
      }
    }

    // Update sync pointer on the user doc
    const pointer = {
      spreadsheetId,
      title: tabTitle,
      folderId: targetFolderId,
      folderName: folderDoc.name,
      headerRow,
      mapping,
      skip,
      lastRowImported: lastNonEmptyRow + 1, // store as 1-based
      lastImportedAt: new Date(),
    };

    const positional = await User.updateOne(
      { email: userEmail, "googleSheets.syncedSheets.spreadsheetId": spreadsheetId, "googleSheets.syncedSheets.title": tabTitle },
      {
        $set: {
          "googleSheets.syncedSheets.$.folderId": pointer.folderId,
          "googleSheets.syncedSheets.$.folderName": pointer.folderName,
          "googleSheets.syncedSheets.$.headerRow": pointer.headerRow,
          "googleSheets.syncedSheets.$.mapping": pointer.mapping,
          "googleSheets.syncedSheets.$.skip": pointer.skip,
          "googleSheets.syncedSheets.$.lastRowImported": pointer.lastRowImported,
          "googleSheets.syncedSheets.$.lastImportedAt": pointer.lastImportedAt,
        },
      }
    );

    if (positional.matchedCount === 0) {
      await User.updateOne(
        { email: userEmail },
        { $push: { "googleSheets.syncedSheets": pointer } }
      );
    }

    return res.status(200).json({
      ok: true,
      imported,
      updated,
      skippedNoKey,
      rowCount: values.length,
      headerRow,
      lastRowImported: lastNonEmptyRow + 1,
      folderId: String(targetFolderId),
      folderName: folderDoc.name,
    });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Import failed";
    return res.status(500).json({ error: message });
  }
}

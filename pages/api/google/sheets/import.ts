// pages/api/google/sheets/import.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";
import ensureNonSystemFolderId from "@/lib/folders/ensureNonSystemFolderId";
import { bumpFolderActivity } from "@/lib/folders/bumpActivity";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

// ... keep your existing small helpers (digits, last10, lcEmail, escapeA1Title)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = String(session.user.email).toLowerCase();

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
    skipExisting = false,
  } = (req.body || {}) as any;

  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });
  if (!title && typeof sheetId !== "number")
    return res.status(400).json({ error: "Provide sheet 'title' or numeric 'sheetId'" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: userEmail }).lean<any>();
    const gs = user?.googleSheets || user?.googleTokens;
    if (!gs?.refreshToken) return res.status(400).json({ error: "Google not connected" });

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI_SHEETS || `${base}/api/connect/google-sheets/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri,
    );
    oauth2.setCredentials({
      access_token: gs.accessToken,
      refresh_token: gs.refreshToken,
      expiry_date: gs.expiryDate,
    });

    const sheets = google.sheets({ version: "v4", auth: oauth2 });
    const drive = google.drive({ version: "v3", auth: oauth2 });

    // Resolve tab title if only sheetId passed
    let tabTitle = title as string | undefined;
    if (!tabTitle && typeof sheetId === "number") {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });
      const found = (meta.data.sheets || []).find((s) => s.properties?.sheetId === sheetId);
      tabTitle = found?.properties?.title || undefined;
      if (!tabTitle) return res.status(400).json({ error: "sheetId not found" });
    }

    // Pull headers+rows
    const safeTitle = (tabTitle || "Sheet1").replace(/'/g, "''");
    const valueResp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${safeTitle}'!A1:ZZ`,
      majorDimension: "ROWS",
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const values = (valueResp.data.values || []) as string[][];
    if (!values.length) {
      return res.status(200).json({
        ok: true,
        inserted: 0,
        updated: 0,
        skippedNoKey: 0,
        skippedExisting: 0,
        rowCount: 0,
        lastRowImported: 0,
        note: "No data in sheet.",
      });
    }

    const headerIdx = Math.max(0, headerRow - 1);
    const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());
    const firstDataRowIndex =
      typeof startRow === "number" ? Math.max(1, startRow) - 1 : headerIdx + 1;
    const lastRowIndex =
      typeof endRow === "number"
        ? Math.min(values.length, Math.max(endRow, firstDataRowIndex + 1)) - 1
        : values.length - 1;

    // Compute deterministic default name from Drive meta + tab title
    const defaultNameMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
    const computedDefault = `${defaultNameMeta.data.name || "Imported Leads"} — ${tabTitle}`;

    // Resolve ONE safe, non-system folder: prefer provided folderId/folderName; else computedDefault
    const { folderId: destId, folderName: destName } = await ensureNonSystemFolderId(
  userEmail,
  folderId ? new mongoose.Types.ObjectId(folderId) : null,
  (folderName || computedDefault)
);


    let inserted = 0;
    let updated = 0;
    let skippedNoKey = 0;
    let lastNonEmptyRow = headerIdx;

    for (let r = firstDataRowIndex; r <= lastRowIndex; r++) {
      const row = values[r] || [];
      const hasAny = row.some((cell) => String(cell ?? "").trim() !== "");
      if (!hasAny) continue;
      lastNonEmptyRow = r;

      // Build doc based on mapping
      const doc: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        if (skip[h]) return;
        const fieldName = mapping[h];
        if (!fieldName) return;
        doc[fieldName] = row[i] ?? "";
      });

      const normalizedPhone = String(doc.phone ?? doc.Phone ?? "").replace(/\D+/g, "");
      const phoneKey = normalizedPhone.slice(-10);
      const emailLower = String(doc.email ?? doc.Email ?? "").trim().toLowerCase();

      if (!phoneKey && !emailLower) {
        skippedNoKey++;
        continue;
      }

      if (skipExisting) {
        const exists = await Lead.findOne({
          userEmail,
          $or: [
            ...(phoneKey ? [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] : []),
            ...(emailLower ? [{ Email: emailLower }, { email: emailLower }] : []),
          ],
        })
          .select("_id")
          .lean();
        if (exists) continue;
      }

      const filter: any = {
        userEmail,
        $or: [
          ...(phoneKey ? [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] : []),
          ...(emailLower ? [{ Email: emailLower }, { email: emailLower }] : []),
        ],
      };

      const setOnInsert: any = { createdAt: new Date(), status: "New" };
      const set: any = {
        userEmail,
        ownerEmail: userEmail,
        folderId: destId,
        folder_name: String(destName),
        "Folder Name": String(destName),
        Email: emailLower || undefined,
        email: emailLower || undefined,
        Phone: String(doc.phone ?? doc.Phone ?? ""),
        normalizedPhone: phoneKey || undefined,
        phoneLast10: phoneKey || undefined,
        "First Name": doc.firstName ?? doc["First Name"],
        "Last Name": doc.lastName ?? doc["Last Name"],
        State: doc.state ?? doc.State,
        Notes: doc.notes ?? doc.Notes,
        Age: doc.Age ?? doc.age,
        updatedAt: new Date(),
        source: "google-sheets",
        sourceSpreadsheetId: spreadsheetId,
        sourceTabTitle: tabTitle,
        sourceRowIndex: r + 1,
      };

      const result = await (Lead as any).updateOne(
        filter,
        { $set: set, $setOnInsert: setOnInsert },
        { upsert: true },
      );
      const upc = result?.upsertedCount || (result?.upsertedId ? 1 : 0) || 0;
      const mod = result?.modifiedCount || 0;
      const match = result?.matchedCount || 0;
      if (upc > 0) inserted += upc;
      else if (mod > 0 || match > 0) updated += 1;
    }

    // Pointer bookkeeping (best effort)
    const pointerRow = lastNonEmptyRow + 1;
    await User.updateOne(
      {
        email: userEmail,
        "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
        "googleSheets.syncedSheets.title": tabTitle,
      },
      {
        $set: {
          "googleSheets.syncedSheets.$.folderId": destId,
          "googleSheets.syncedSheets.$.folderName": destName,
          "googleSheets.syncedSheets.$.headerRow": headerRow,
          "googleSheets.syncedSheets.$.mapping": mapping,
          "googleSheets.syncedSheets.$.skip": skip,
          "googleSheets.syncedSheets.$.lastRowImported": pointerRow,
          "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
          ...(typeof sheetId === "number" ? { "googleSheets.syncedSheets.$.sheetId": sheetId } : {}),
        },
      },
      { strict: false },
    ).catch(() => {});

    // Bump folder activity so it shows on top
    await bumpFolderActivity(userEmail, destId);

    return res.status(200).json({
      ok: true,
      inserted,
      updated,
      skippedNoKey,
      skippedExisting: skipExisting ? undefined : 0,
      rowCount: values.length,
      headerRow,
      lastRowImported: pointerRow,
      folderId: String(destId),
      folderName: destName,
    });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Import failed";
    return res.status(500).json({ error: message });
  }
}

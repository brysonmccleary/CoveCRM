// pages/api/google/sheets/import.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import { ensureSafeFolder } from "@/lib/ensureSafeFolder";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLeadIfWatched";

type ImportBody = {
  spreadsheetId: string;
  title?: string;
  sheetId?: number;
  headerRow?: number;
  startRow?: number;
  endRow?: number;
  folderId?: string;          // ← accepted again
  folderName?: string;        // ← accepted again
  mapping: Record<string, string>;
  skip?: Record<string, boolean>;
  createFolderIfMissing?: boolean;
  skipExisting?: boolean;
};

const FINGERPRINT = "sheets-import-safe-restore-2025-11-12";

const digits = (s: any) => String(s ?? "").replace(/\D+/g, "");
const last10 = (s?: string) => (digits(s).slice(-10) || "");
const lcEmail = (s: any) => {
  const v = String(s ?? "").trim().toLowerCase();
  return v || "";
};
const escapeA1Title = (t: string) => t.replace(/'/g, "''");

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
    createFolderIfMissing = true,
    skipExisting = false,
  } = (req.body || {}) as ImportBody;

  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });
  if (!title && typeof sheetId !== "number") {
    return res.status(400).json({ error: "Provide sheet 'title' or numeric 'sheetId'" });
  }

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
    const drive  = google.drive({ version: "v3", auth: oauth2 });

    // Resolve tab title if only sheetId
    let tabTitle = title;
    if (!tabTitle && typeof sheetId === "number") {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });
      const found = (meta.data.sheets || []).find(s => s.properties?.sheetId === sheetId);
      tabTitle = found?.properties?.title || undefined;
      if (!tabTitle) return res.status(400).json({ error: "sheetId not found" });
    }
    const safeTitle = escapeA1Title(tabTitle!);

    // Pull values
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
        fingerprint: FINGERPRINT,
        inserted: 0,
        updated: 0,
        skippedNoKey: 0,
        skippedExisting: 0,
        rowCount: 0,
        headerRow,
        lastRowImported: 0,
        note: "No data in sheet.",
      });
    }

    // Build the canonical default name "<Drive Name> — <Tab Title>"
    const fileMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
    const spreadsheetName = fileMeta.data.name || "Imported Leads";
    const defaultName = `${spreadsheetName} — ${tabTitle}`;

    // ✅ CRITICAL: resolve via ensureSafeFolder (clamps any system name to a safe one)
    const folderDoc = await ensureSafeFolder({
      userEmail,
      folderId,
      folderName,
      defaultName,
      source: "google-sheets",
    });

    const headerIdx = Math.max(0, headerRow - 1);
    const headers = (values[headerIdx] || []).map(h => String(h || "").trim());

    const firstDataRowIndex =
      typeof startRow === "number" ? Math.max(1, startRow) - 1 : headerIdx + 1;
    const lastRowIndex =
      typeof endRow === "number"
        ? Math.min(values.length, Math.max(endRow, firstDataRowIndex + 1)) - 1
        : values.length - 1;

    let inserted = 0, updated = 0, skippedNoKey = 0, skippedExistingCount = 0, lastNonEmptyRow = headerIdx;

    for (let r = firstDataRowIndex; r <= lastRowIndex; r++) {
      const row = values[r] || [];
      if (!row.some(c => String(c ?? "").trim() !== "")) continue;
      lastNonEmptyRow = r;

      const doc: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        if (skip[h]) return;
        const fieldName = (mapping as Record<string, string>)[h];
        if (!fieldName) return;
        doc[fieldName] = row[i] ?? "";
      });

      // Strip any incoming status/disposition fields
      delete doc.status;
      delete (doc as any).Status;
      delete (doc as any).Disposition;
      delete (doc as any)["Disposition"];
      delete (doc as any)["Status"];

      const phoneKey = last10(doc.phone ?? doc.Phone ?? "");
      const emailLower = lcEmail(doc.email ?? doc.Email ?? "");
      if (!phoneKey && !emailLower) { skippedNoKey++; continue; }

      if (skipExisting) {
        const exists = await Lead.findOne({
          userEmail,
          $or: [
            ...(phoneKey ? [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] : []),
            ...(emailLower ? [{ Email: emailLower }, { email: emailLower }] : []),
          ],
        }).select("_id").lean();
        if (exists) { skippedExistingCount++; continue; }
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
        folderId: folderDoc._id,
        folder_name: String(folderDoc.name),
        "Folder Name": String(folderDoc.name),
        status: "New", // (matches your prior working file)
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
        { upsert: true }
      );

      const upc = (result?.upsertedCount || (result?.upsertedId ? 1 : 0) || 0) as number;

      const found = await Lead.findOne(filter).select("_id").lean<{ _id: any } | null>();
      const leadId: string | undefined =
        (result as any)?.upsertedId ?? (found?._id ? String(found._id) : undefined);

      if (upc > 0) inserted += upc;
      else if ((result?.modifiedCount || 0) > 0 || (result?.matchedCount || 0) > 0) updated += 1;

      if (leadId) {
        await enrollOnNewLeadIfWatched({
          userEmail,
          folderId: String(folderDoc._id),
          leadId,
        });
      }
    }

    // Persist pointer & canonical folder on the user doc (best-effort)
    try {
      const positional = await User.updateOne(
        {
          email: userEmail,
          "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
          "googleSheets.syncedSheets.title": tabTitle,
        },
        {
          $set: {
            "googleSheets.syncedSheets.$.folderId": folderDoc._id,
            "googleSheets.syncedSheets.$.folderName": folderDoc.name,
            "googleSheets.syncedSheets.$.headerRow": headerRow,
            "googleSheets.syncedSheets.$.mapping": mapping,
            "googleSheets.syncedSheets.$.skip": skip,
            "googleSheets.syncedSheets.$.lastRowImported": lastNonEmptyRow + 1,
            "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
            ...(typeof sheetId === "number" ? { "googleSheets.syncedSheets.$.sheetId": sheetId } : {}),
          },
        }
      );
      if (positional.matchedCount === 0) {
        await User.updateOne(
          { email: userEmail },
          {
            $push: {
              "googleSheets.syncedSheets": {
                spreadsheetId,
                title: tabTitle,
                ...(typeof sheetId === "number" ? { sheetId } : {}),
                folderId: folderDoc._id,
                folderName: folderDoc.name,
                headerRow,
                mapping,
                skip,
                lastRowImported: lastNonEmptyRow + 1,
                lastImportedAt: new Date(),
              },
            },
          },
          { strict: false }
        );
      }
    } catch {}

    return res.status(200).json({
      ok: true,
      fingerprint: FINGERPRINT,
      inserted,
      updated,
      skippedNoKey,
      skippedExisting: skipExisting ? skippedExistingCount : 0,
      rowCount: values.length,
      headerRow,
      lastRowImported: lastNonEmptyRow + 1,
      folderId: String(folderDoc._id),
      folderName: folderDoc.name,
    });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Import failed";
    return res.status(500).json({ error: message, fingerprint: FINGERPRINT });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import { ensureNonSystemFolderId } from "@/lib/folders/ensureNonSystemFolderId";

type ImportBody = {
  spreadsheetId: string;
  title?: string;
  sheetId?: number;
  headerRow?: number;
  startRow?: number;
  endRow?: number;
  folderId?: string;
  folderName?: string;
  mapping: Record<string, string>;
  skip?: Record<string, boolean>;
  createFolderIfMissing?: boolean; // still honored—but we always force non-system
  skipExisting?: boolean;
};

const digits = (s: any) => String(s ?? "").replace(/\D+/g, "");
const last10 = (s?: string) => digits(s).slice(-10) || "";
const lcEmail = (s: any) => { const v = String(s ?? "").trim().toLowerCase(); return v || ""; };
const escapeA1Title = (t: string) => t.replace(/'/g, "''");

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
    skipExisting = false,
  } = (req.body || {}) as ImportBody;

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
      `https://${(req.headers["x-forwarded-host"] as string) || req.headers.host}`;
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

    // Resolve tab title if only sheetId
    let tabTitle = title;
    if (!tabTitle && typeof sheetId === "number") {
      const meta = await sheets.spreadsheets.get({
        spreadsheetId,
        fields: "sheets(properties(sheetId,title))",
      });
      const found = (meta.data.sheets || []).find((s) => s.properties?.sheetId === sheetId);
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

    // Build safe default folder name and force NON-system folder
    const meta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
    const defaultName = `${meta.data.name || "Imported Leads"} — ${tabTitle}`;

    // We may receive a system folder id/name from the client; resolve it, then force-safe.
    // Create or reuse the name given by client (or default) upstream in UI—doesn't matter:
    // we always end with a safe id/name for writes.
    let folderIdToCheck: string | undefined = folderId;
    let folderNameToCheck: string | undefined = folderName || defaultName;

    // If we have neither a valid id nor a name, just use defaultName to create/locate.
    if (!folderIdToCheck && !folderNameToCheck) folderNameToCheck = defaultName;

    // Try to look up/create the folder candidate quickly (write-only best-effort).
    // We do NOT trust the candidate; we immediately pass it through ensureNonSystemFolderId.
    const candidate = await User.db!.collection("folders").findOneAndUpdate(
      { userEmail, name: folderNameToCheck },
      { $setOnInsert: { userEmail, name: folderNameToCheck, source: "google-sheets" } },
      { upsert: true, returnDocument: "after" }
    );
    const candidateId = (candidate.value?._id as any) || folderIdToCheck;

    const safe = await ensureNonSystemFolderId(
      userEmail,
      candidateId as any,
      folderNameToCheck || defaultName
    );
    const safeFolderId = safe.folderId;
    const safeFolderName = safe.folderName;

    let inserted = 0,
      updated = 0,
      skippedNoKey = 0,
      skippedExistingCount = 0,
      lastNonEmptyRow = headerIdx;

    for (let r = firstDataRowIndex; r <= lastRowIndex; r++) {
      const row = values[r] || [];
      if (!row.some((cell) => String(cell ?? "").trim() !== "")) continue;
      lastNonEmptyRow = r;

      const doc: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        if (skip[h]) return;
        const fieldName = mapping[h];
        if (!fieldName) return;
        doc[fieldName] = row[i] ?? "";
      });

      const phoneKey = last10(doc.phone ?? doc.Phone ?? "");
      const emailLower = lcEmail(doc.email ?? doc.Email ?? "");
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
        if (exists) {
          skippedExistingCount++;
          continue;
        }
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
        folderId: safeFolderId,
        folder_name: String(safeFolderName),
        ["Folder Name"]: String(safeFolderName),
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
      const mod = (result?.modifiedCount || 0) as number;
      const match = (result?.matchedCount || 0) as number;

      if (upc > 0) inserted += upc;
      else if (mod > 0 || match > 0) updated += 1;
    }

    // Persist pointer & safe folder on the user doc
    await User.updateOne(
      {
        email: userEmail,
        "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
        "googleSheets.syncedSheets.title": tabTitle,
      },
      {
        $set: {
          "googleSheets.syncedSheets.$.folderId": safeFolderId,
          "googleSheets.syncedSheets.$.folderName": safeFolderName,
          "googleSheets.syncedSheets.$.headerRow": headerRow,
          "googleSheets.syncedSheets.$.mapping": mapping,
          "googleSheets.syncedSheets.$.skip": skip,
          "googleSheets.syncedSheets.$.lastRowImported": lastNonEmptyRow + 1,
          "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
        },
      },
      { strict: false }
    ).catch(() => {});

    return res.status(200).json({
      ok: true,
      inserted,
      updated,
      skippedNoKey,
      skippedExisting: skipExisting ? skippedExistingCount : 0,
      rowCount: values.length,
      headerRow,
      lastRowImported: lastNonEmptyRow + 1,
      folderId: String(safeFolderId),
      folderName: String(safeFolderName),
    });
  } catch (err: any) {
    const message = err?.errors?.[0]?.message || err?.message || "Import failed";
    return res.status(500).json({ error: message });
  }
}

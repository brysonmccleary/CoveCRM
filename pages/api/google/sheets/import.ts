import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

type ImportBody = {
  spreadsheetId: string;
  title?: string;
  sheetId?: number;
  headerRow?: number;
  startRow?: number;
  endRow?: number;
  folderId?: string;
  folderName?: string;
  mapping: Record<string, string>;     // CSVHeader -> CanonicalField
  skip?: Record<string, boolean>;      // headers to ignore
  createFolderIfMissing?: boolean;
  skipExisting?: boolean;              // if true, do NOT move/update existing
};

function digits(s: any) { return String(s ?? "").replace(/\D+/g, ""); }
function last10(s?: string) { const d = digits(s); return d.slice(-10) || ""; }
function lcEmail(s: any) { const v = String(s ?? "").trim().toLowerCase(); return v || ""; }
function escapeA1Title(title: string) { return title.replace(/'/g, "''"); }

async function resolveFolder(
  userEmail: string,
  opts: { folderId?: string; folderName?: string; defaultName?: string; create?: boolean }
) {
  // Name wins (create if requested)
  const byName = (opts.folderName || "").trim();
  if (byName) {
    if (isSystemFolder(byName)) throw new Error("Cannot import into system folders");
    const doc = await Folder.findOneAndUpdate(
      { userEmail, name: byName },
      { $setOnInsert: { userEmail, name: byName, source: "google-sheets" } },
      { new: true, upsert: !!opts.create }
    );
    if (!doc) throw new Error("Folder not found/created");
    return doc;
  }

  // By id
  if (opts.folderId) {
    const doc = await Folder.findOne({ _id: new mongoose.Types.ObjectId(opts.folderId), userEmail });
    if (!doc) throw new Error("Folder not found or not owned by user");
    if (isSystemFolder(doc.name)) throw new Error("Cannot import into system folders");
    return doc;
  }

  // Default
  const def = (opts.defaultName || "").trim();
  if (!def) throw new Error("Missing target folder");
  if (isSystemFolder(def)) throw new Error("Cannot import into system folders");
  const doc = await Folder.findOneAndUpdate(
    { userEmail, name: def },
    { $setOnInsert: { userEmail, name: def, source: "google-sheets" } },
    { new: true, upsert: true }
  );
  return doc;
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
    skipExisting = false,
  } = (req.body || {}) as ImportBody;

  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });
  if (!title && typeof sheetId !== "number") return res.status(400).json({ error: "Provide sheet 'title' or numeric 'sheetId'" });
  if (folderName && isSystemFolder(folderName)) return res.status(400).json({ error: "Cannot import into system folders" });

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

    // Resolve tab title if only sheetId passed
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

    // Resolve destination folder (name wins > id > default)
    const defaultNameMeta = await google.drive({ version: "v3", auth: oauth2 }).files.get({
      fileId: spreadsheetId,
      fields: "name",
    });
    const defaultName = `${defaultNameMeta.data.name || "Imported Leads"} — ${tabTitle}`;
    const folderDoc = await resolveFolder(userEmail, {
      folderId,
      folderName,
      defaultName,
      create: createFolderIfMissing,
    });
    if (!folderDoc) return res.status(400).json({ error: "Folder not found/created" });

    let inserted = 0;
    let updated = 0;
    let skippedNoKey = 0;
    let skippedExistingCount = 0;
    let lastNonEmptyRow = headerIdx;

    for (let r = firstDataRowIndex; r <= lastRowIndex; r++) {
      const row = values[r] || [];
      const hasAny = row.some((cell) => String(cell ?? "").trim() !== "");
      if (!hasAny) continue;

      lastNonEmptyRow = r;

      // Build doc using header->field mapping, skipping configured headers
      const doc: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        if (skip[h]) return;
        const fieldName = mapping[h];
        if (!fieldName) return;
        doc[fieldName] = row[i] ?? "";
      });

      const normalizedPhone = digits(doc.phone ?? doc.Phone ?? "");
      const phoneKey = last10(normalizedPhone);
      const emailLower = lcEmail(doc.email ?? doc.Email ?? "");

      if (!phoneKey && !emailLower) {
        skippedNoKey++;
        continue;
      }

      // Optionally skip existing without moving them
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

      // Build upsert
      const filter: any = {
        userEmail,
        $or: [
          ...(phoneKey ? [{ phoneLast10: phoneKey }, { normalizedPhone: phoneKey }] : []),
          ...(emailLower ? [{ Email: emailLower }, { email: emailLower }] : []),
        ],
      };

      // NEW invariant: status only in $setOnInsert; for existing, only update if provided
      const incomingStatus = typeof doc.status === "string" && doc.status.trim() ? doc.status : undefined;

      const setOnInsert: any = {
        createdAt: new Date(),
        status: incomingStatus || "New",
      };

      const set: any = {
        userEmail,
        ownerEmail: userEmail,
        folderId: folderDoc._id,
        folder_name: String(folderDoc.name),
        "Folder Name": String(folderDoc.name),
        // identity mirrors
        Email: emailLower || undefined,
        email: emailLower || undefined,
        Phone: String(doc.phone ?? doc.Phone ?? ""),
        normalizedPhone: phoneKey || undefined,
        phoneLast10: phoneKey || undefined,
        // optional mapped fields
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

      // If this is an existing lead, we'll conditionally add status into $set *only if provided*
      const existing = await Lead.findOne(filter).select("_id").lean<{ _id: mongoose.Types.ObjectId } | null>();
      if (existing && incomingStatus) set.status = incomingStatus;

      const result = await (Lead as any).updateOne(
        filter,
        { $set: set, $setOnInsert: setOnInsert },
        { upsert: true }
      );

      const upc = result?.upsertedCount || (result?.upsertedId ? 1 : 0) || 0;
      const mod = result?.modifiedCount || 0;
      const match = result?.matchedCount || 0;

      if (upc > 0) inserted += upc;
      else if (mod > 0 || match > 0) updated += 1;
    }

    // Update sync pointer on the user doc (best-effort)
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
    } catch {
      // ignore pointer errors
    }

    return res.status(200).json({
      ok: true,
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
    return res.status(500).json({ error: message });
  }
}

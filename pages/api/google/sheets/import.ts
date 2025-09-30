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
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

/* ===================== tiny utils ===================== */
function digits(s: any) {
  return String(s ?? "").replace(/\D+/g, "");
}
function last10(s?: string) {
  const d = digits(s);
  return d.slice(-10) || "";
}
function lcEmail(s: any) {
  const v = String(s ?? "").trim().toLowerCase();
  return v || "";
}
function escapeA1Title(title: string) {
  return title.replace(/'/g, "''");
}

/* =========================================================
   Deterministic folder resolver (NO AUTO FALLBACKS)
   - Prefer folderName (create if missing)
   - Else targetFolderId (must belong to user)
   - Always block system folders by name or by id
   ========================================================= */
async function selectImportFolder(
  userEmail: string,
  opts: { targetFolderId?: string; folderName?: string }
) {
  await dbConnect(); // make sure native driver is available

  const byName = (opts.folderName || "").trim();

  // A) By NAME (create if missing) — strict system block first
  if (byName) {
    if (isSystemFolder(byName)) {
      const msg = "Cannot import into system folders";
      console.warn("Sheets import blocked: system folder by NAME", { userEmail, byName });
      const e: any = new Error(msg);
      e.status = 400;
      throw e;
    }

    // Use native driver for exact equality (no collation/plugins surprises)
    const coll = mongoose.connection.db!.collection("folders");
    const found = await coll.findOne({ userEmail, name: byName });

    if (found) {
      return { folder: { ...found, _id: found._id } as any, selection: "foundByName" as const };
    }

    const toInsert = { userEmail, name: byName, source: "google-sheets" };
    const ins = await coll.insertOne(toInsert);
    const created = await coll.findOne({ _id: ins.insertedId });
    return { folder: created as any, selection: "createdByName" as const };
  }

  // B) By ID — must belong to user; block if the actual name is system
  if (opts.targetFolderId) {
    const f = await Folder.findOne({ _id: opts.targetFolderId, userEmail });
    if (!f) {
      const msg = "Folder not found or not owned by user";
      console.warn("Sheets import blocked: bad ID", { userEmail, targetFolderId: opts.targetFolderId });
      const e: any = new Error(msg);
      e.status = 400;
      throw e;
    }
    if (isSystemFolder((f as any).name)) {
      const msg = "Cannot import into system folders";
      console.warn("Sheets import blocked: system folder by ID", {
        userEmail,
        folderId: String(f._id),
        folderName: (f as any).name,
      });
      const e: any = new Error(msg);
      e.status = 400;
      throw e;
    }
    return { folder: f, selection: "byId" as const };
  }

  // C) No folder given — hard stop (this prevents any accidental defaults)
  const msg = "A folder is required: provide folderName (creates if missing) or targetFolderId.";
  console.warn("Sheets import blocked: no folder provided", { userEmail });
  const e: any = new Error(msg);
  e.status = 400;
  throw e;
}

/* ===================== handler ===================== */
type ImportBody = {
  spreadsheetId: string;
  title?: string;     // sheet/tab title
  sheetId?: number;   // alternative to title
  headerRow?: number; // default 1
  startRow?: number;  // optional
  endRow?: number;    // optional
  folderId?: string;  // <- UI may send this as targetFolderId
  folderName?: string;
  mapping: Record<string, string>; // CSVHeader -> CanonicalField
  skip?: Record<string, boolean>;  // headers to ignore
  skipExisting?: boolean;          // if true, do not move/update existing
};

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
  } = (req.body || {}) as ImportBody;

  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });
  if (!title && typeof sheetId !== "number") {
    return res.status(400).json({ error: "Provide sheet 'title' or numeric 'sheetId'" });
  }
  if (folderName && isSystemFolder(folderName)) {
    return res.status(400).json({ error: "Cannot import into system folders" });
  }

  try {
    await dbConnect();

    // ---- Google auth for Sheets
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

    // Resolve tab title if only sheetId is provided
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
        headerRow,
        note: "No data in sheet.",
      });
    }

    // Strict folder resolution (no defaults)
    const { folder } = await selectImportFolder(userEmail, {
      targetFolderId: folderId,
      folderName,
    });

    // Parse rows
    const headerIdx = Math.max(0, headerRow - 1);
    const headers = (values[headerIdx] || []).map((h) => String(h || "").trim());

    const firstDataRowIndex =
      typeof startRow === "number" ? Math.max(1, startRow) - 1 : headerIdx + 1;
    const lastRowIndex =
      typeof endRow === "number"
        ? Math.min(values.length, Math.max(endRow, firstDataRowIndex + 1)) - 1
        : values.length - 1;

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

      // header -> field mapping with skip
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

      const setOnInsert: any = { createdAt: new Date(), userEmail, status: "New" };
      const set: any = {
        ownerEmail: userEmail,
        folderId: (folder as any)._id,
        folder_name: String((folder as any).name),
        "Folder Name": String((folder as any).name),
        updatedAt: new Date(),
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

      const upc = result?.upsertedCount || (result?.upsertedId ? 1 : 0) || 0;
      const mod = result?.modifiedCount || 0;
      const match = result?.matchedCount || 0;

      if (upc > 0) inserted += upc;
      else if (mod > 0 || match > 0) updated += 1;
    }

    // Best-effort pointer save
    try {
      await User.updateOne(
        {
          email: userEmail,
          "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
          "googleSheets.syncedSheets.title": tabTitle,
        },
        {
          $set: {
            "googleSheets.syncedSheets.$.folderId": (folder as any)._id,
            "googleSheets.syncedSheets.$.folderName": (folder as any).name,
            "googleSheets.syncedSheets.$.headerRow": headerRow,
            "googleSheets.syncedSheets.$.mapping": mapping,
            "googleSheets.syncedSheets.$.skip": skip,
            "googleSheets.syncedSheets.$.lastRowImported": lastNonEmptyRow + 1,
            "googleSheets.syncedSheets.$.lastImportedAt": new Date(),
            ...(typeof sheetId === "number" ? { "googleSheets.syncedSheets.$.sheetId": sheetId } : {}),
          },
        }
      );
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
      folderId: String((folder as any)._id),
      folderName: (folder as any).name,
    });
  } catch (err: any) {
    const status = err?.status === 400 ? 400 : 500;
    const message = err?.errors?.[0]?.message || err?.message || "Import failed";
    return res.status(status).json({ error: message });
  }
}

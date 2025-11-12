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

/** Fuzzy “system-ish” test — blocks sold/s0ld/so1d etc. */
function isSystemish(name?: string) {
  if (!name) return false;
  const s = String(name).trim().toLowerCase();
  // collapse multiple spaces and lookalikes (0↔o, 1↔l, i)
  const canon = s
    .replace(/[\s_-]+/g, "")
    .replace(/0/g, "o")
    .replace(/[1i]/g, "l");
  return canon === "sold" || isSystemFolder(s);
}

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
  createFolderIfMissing?: boolean;
  skipExisting?: boolean;
};

const digits = (s: any) => String(s ?? "").replace(/\D+/g, "");
const last10 = (s?: string) => (digits(s).slice(-10) || "");
const lcEmail = (s: any) => {
  const v = String(s ?? "").trim().toLowerCase();
  return v || "";
};
const escapeA1Title = (t: string) => t.replace(/'/g, "''");

async function resolveFolder(
  userEmail: string,
  opts: { folderId?: string; folderName?: string; defaultName: string; create?: boolean }
) {
  // Hard block system-ish names
  if (opts.folderName && isSystemish(opts.folderName)) {
    throw Object.assign(new Error("Cannot import into system folders"), { status: 400 });
  }

  // Name wins (create if missing)
  const byName = (opts.folderName || "").trim();
  if (byName) {
    const doc = await Folder.findOneAndUpdate(
      { userEmail, name: byName },
      { $setOnInsert: { userEmail, name: byName, source: "google-sheets" } },
      { new: true, upsert: true }
    );
    return doc;
  }

  // Else by ID (and ensure not a system folder)
  if (opts.folderId) {
    const doc = await Folder.findOne({
      _id: new mongoose.Types.ObjectId(opts.folderId),
      userEmail,
    });
    if (!doc) throw Object.assign(new Error("Folder not found or not owned by user"), { status: 400 });
    if (isSystemish(String(doc.name))) {
      throw Object.assign(new Error("Cannot import into system folders"), { status: 400 });
    }
    return doc;
  }

  // Else use computed default
  const def = String(opts.defaultName || "").trim();
  if (!def) throw Object.assign(new Error("Missing target folder"), { status: 400 });
  const safe = isSystemish(def) ? `${def} (Leads)` : def;
  const doc = await Folder.findOneAndUpdate(
    { userEmail, name: safe },
    { $setOnInsert: { userEmail, name: safe, source: "google-sheets" } },
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
    createFolderIfMissing = true, // kept for compatibility
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
      process.env.GOOGLE_REDIRECT_URI_SHEETS || `${base}/api/connect/google-sheets/callback`;

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
    const drive = google.drive({ version: "v3", auth: oauth2 });

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

    // Build safe default folder name and resolve non-system folder
    const meta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
    const defaultName = `${meta.data.name || "Imported Leads"} — ${tabTitle}`;
    const folderDoc = await resolveFolder(userEmail, {
      folderId,
      folderName,
      defaultName,
      create: createFolderIfMissing,
    });

    // Final belt-and-suspenders:
    if (isSystemish(String(folderDoc.name))) {
      return res.status(400).json({ error: "Cannot import into system folders" });
    }

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

      const doc: Record<string, any> = {};
      headers.forEach((h, i) => {
        if (!h) return;
        if (skip[h]) return;
        const fieldName = mapping[h];
        if (!fieldName) return;
        doc[fieldName] = row[i] ?? "";
      });

      // Strip any incoming status/disposition from the sheet
      delete doc.status;
      delete (doc as any).Status;
      delete (doc as any).Disposition;
      delete (doc as any)["Disposition"];
      delete (doc as any)["Status"];

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
        folderId: folderDoc._id,
        folder_name: String(folderDoc.name),
        "Folder Name": String(folderDoc.name),
        status: "New", // force New on updates too
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

      const upc = result?.upsertedCount || (result as any)?.upsertedId ? 1 : 0;
      if (upc > 0) inserted += upc;
      else if ((result?.modifiedCount || 0) > 0 || (result?.matchedCount || 0) > 0) updated += 1;
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
    const code = err?.status === 400 ? 400 : 500;
    const message = err?.errors?.[0]?.message || err?.message || "Import failed";
    return res.status(code).json({ error: message });
  }
}

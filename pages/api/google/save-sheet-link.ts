// /pages/api/google/save-sheet-link.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";

type LegacyBody = {
  sheetId?: string;       // <-- legacy param: actually the spreadsheetId
  sheetName?: string;     // <-- legacy tab title
  folderId?: string;      // <-- legacy target (power users)
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
};

const SYSTEM_FOLDERS = new Set(["Sold", "Not Interested", "Booked Appointment", "No Show"]);

function parseSpreadsheetId(urlOrId: string) {
  if (!urlOrId) return "";
  if (/docs.google.com\/spreadsheets\/d\//.test(urlOrId)) {
    const m = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m?.[1] || "";
  }
  return urlOrId;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userEmail = String(session.user.email).toLowerCase();

  await dbConnect();
  const user = await User.findOne({ email: userEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  // Legacy GET (debug/UI list)
  if (req.method === "GET") {
    const gs: any = (user as any).googleSheets || {};
    const sheets: any[] = gs.syncedSheets || gs.sheets || [];
    return res.status(200).json({ sheets });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // ---- Normalize legacy body into the new shape ----
  const {
    sheetId: legacySheetId,
    sheetName: legacySheetName,
    folderId,
    headerRow = 1,
    mapping = {},
    skip = {},
  } = (req.body || {}) as LegacyBody;

  const spreadsheetId = parseSpreadsheetId(String(legacySheetId || ""));
  const requestedTitle = legacySheetName ? String(legacySheetName) : undefined;
  if (!spreadsheetId || !requestedTitle) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // OAuth from saved tokens (support both .googleSheets and .googleTokens)
  const gs: any = (user as any).googleSheets || {};
  const legacyTok: any = (user as any).googleTokens || {};
  const tok = gs?.refreshToken ? gs : legacyTok?.refreshToken ? legacyTok : null;
  if (!tok?.refreshToken) return res.status(400).json({ message: "No Google refresh token on user" });

  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${base}/api/connect/google-sheets/callback`
  );
  oauth2.setCredentials({
    access_token: tok.accessToken,
    refresh_token: tok.refreshToken,
    expiry_date: tok.expiryDate,
  });

  const sheetsApi = google.sheets({ version: "v4", auth: oauth2 });
  const drive = google.drive({ version: "v3", auth: oauth2 });

  // Resolve tab metadata (sheetId <-> title)
  let resolvedTitle: string | undefined = requestedTitle;
  let resolvedTabId: number | undefined = undefined;
  try {
    const meta = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))",
    });
    const tabs = meta.data.sheets || [];
    if (resolvedTitle) {
      resolvedTabId = tabs.find(t => t.properties?.title === resolvedTitle)?.properties?.sheetId || undefined;
    }
    if (!resolvedTitle && tabs[0]?.properties?.title) {
      resolvedTitle = tabs[0].properties!.title!;
      resolvedTabId = tabs[0].properties!.sheetId!;
    }
  } catch {
    return res.status(400).json({ message: "Unable to read spreadsheet metadata" });
  }
  if (!resolvedTitle) {
    return res.status(400).json({ message: "Missing tab title and unable to resolve" });
  }

  // Determine canonical folder name (ALWAYS auto-generated)
  const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
  const canonicalName = `Google Sheet — ${driveMeta.data.name} — ${resolvedTitle}`;

  // Find/create Folder:
  // - If explicit folderId is given, respect it verbatim (power users).
  // - Otherwise, upsert to canonical non-system name; never auto-use system folders.
  let folderDoc: any = null;

  if (folderId) {
    try {
      folderDoc = await Folder.findOne({ _id: new mongoose.Types.ObjectId(folderId), userEmail });
    } catch { /* ignore */ }
  }

  if (!folderDoc) {
    const nameToUse = SYSTEM_FOLDERS.has(canonicalName) ? `${canonicalName} (auto)` : canonicalName;
    folderDoc = await Folder.findOneAndUpdate(
      { userEmail, name: nameToUse },
      { $setOnInsert: { userEmail, name: nameToUse, source: "google-sheets" } },
      { new: true, upsert: true }
    );
  }

  // Build normalized link (pointer starts at header row)
  const link = {
    spreadsheetId,
    title: resolvedTitle,
    sheetId: resolvedTabId,
    headerRow,
    mapping,
    skip,
    folderId: folderDoc._id,
    folderName: folderDoc.name,
    lastRowImported: headerRow,
    lastImportedAt: new Date(),
  };

  // Ensure googleSheets structure and SAVE NORMALIZED ENTRY
  if (!(user as any).googleSheets) {
    (user as any).googleSheets = {
      accessToken: tok.accessToken || "",
      refreshToken: tok.refreshToken || "",
      expiryDate: tok.expiryDate || 0,
      googleEmail: gs.googleEmail || legacyTok.googleEmail || userEmail,
      syncedSheets: [],
      sheets: [],
    };
  }

  // De-dup: prefer normalized entries; remove legacy duplicates for same sheet+title
  const arr: any[] = Array.isArray((user as any).googleSheets.syncedSheets)
    ? (user as any).googleSheets.syncedSheets
    : [];

  // Remove any legacy items that match this spreadsheetId+title
  const filtered = arr.filter((s: any) => {
    const isLegacy = s && typeof s.sheetId === "string" && s.sheetName;
    if (!isLegacy) return true;
    const legacySpreadsheetId = s.sheetId;
    const legacyTitle = s.sheetName;
    return !(legacySpreadsheetId === spreadsheetId && legacyTitle === resolvedTitle);
  });

  // Upsert normalized
  const ix = filtered.findIndex((s: any) =>
    s.spreadsheetId === spreadsheetId && (s.sheetId === resolvedTabId || s.title === resolvedTitle)
  );
  if (ix >= 0) filtered[ix] = { ...filtered[ix], ...link };
  else filtered.push(link);

  (user as any).googleSheets.syncedSheets = filtered;

  // Keep .sheets array in sync (legacy readers), but write NORMALIZED (not legacy)
  (user as any).googleSheets.sheets = filtered;

  await user.save();
  return res.status(200).json({ ok: true, link });
}

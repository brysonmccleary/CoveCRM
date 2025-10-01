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
  sheetId?: string;       // legacy: actually spreadsheetId (or URL)
  sheetName?: string;     // legacy: tab title
  folderId?: string;      // optional power-user override
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
};

const SYSTEM_FOLDERS = new Set(["Sold","Not Interested","Booked Appointment","No Show"]);

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
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();
  await dbConnect();
  const user = await User.findOne({ email: userEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  // GET -> list saved links
  if (req.method === "GET") {
    const gs: any = (user as any).googleSheets || {};
    return res.status(200).json({ sheets: gs.syncedSheets || gs.sheets || [] });
  }

  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  // Normalize legacy body
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
  if (!spreadsheetId || !requestedTitle) return res.status(400).json({ message: "Missing required fields" });

  // OAuth credentials from user
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

  // Resolve tab metadata
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
  if (!resolvedTitle) return res.status(400).json({ message: "Missing tab title and unable to resolve" });

  // Canonical folder name (always auto)
  const driveMeta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
  const canonicalName = `Google Sheet — ${driveMeta.data.name} — ${resolvedTitle}`;

  // Find/create folder (respect explicit folderId; otherwise canonical)
  let folderDoc: any = null;
  if (folderId) {
    try {
      folderDoc = await Folder.findOne({ _id: new mongoose.Types.ObjectId(folderId), userEmail });
    } catch { /* ignore */ }
  }
  if (!folderDoc) {
    const safeName = SYSTEM_FOLDERS.has(canonicalName) ? `${canonicalName} (auto)` : canonicalName;
    folderDoc = await Folder.findOneAndUpdate(
      { userEmail, name: safeName },
      { $setOnInsert: { userEmail, name: safeName, source: "google-sheets" } },
      { new: true, upsert: true }
    );
  }

  // Normalized link
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

  // Ensure container
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

  // Remove any legacy entries for this sheet/title; upsert normalized one
  const arr: any[] = Array.isArray((user as any).googleSheets.syncedSheets)
    ? (user as any).googleSheets.syncedSheets
    : [];

  const filtered = arr.filter((s: any) => {
    const isLegacy = s && typeof s.sheetId === "string" && s.sheetName;
    if (!isLegacy) return true;
    const legacySpreadsheetId = s.sheetId;
    const legacyTitle = s.sheetName;
    return !(legacySpreadsheetId === spreadsheetId && legacyTitle === resolvedTitle);
  });

  const ix = filtered.findIndex((s: any) =>
    s.spreadsheetId === spreadsheetId && (s.sheetId === resolvedTabId || s.title === resolvedTitle)
  );
  if (ix >= 0) filtered[ix] = { ...filtered[ix], ...link };
  else filtered.push(link);

  (user as any).googleSheets.syncedSheets = filtered;
  (user as any).googleSheets.sheets = filtered; // keep legacy readers aligned

  await user.save();
  return res.status(200).json({ ok: true, link });
}

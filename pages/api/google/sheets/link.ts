// /pages/api/google/sheets/link.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import mongoose from "mongoose";

type Body = {
  spreadsheetId?: string;   // or provide spreadsheetUrl
  spreadsheetUrl?: string;  // we'll parse spreadsheetId
  title?: string;           // tab name (optional if sheetId provided)
  sheetId?: number;         // numeric tab id (preferred when available)
  headerRow?: number;       // default 1
  mapping?: Record<string,string>;
  skip?: Record<string,boolean>;
  folderName?: string;      // if absent, auto-name from Drive file + tab
  folderId?: string;        // optional: link to existing folder
};

function parseSpreadsheetId(urlOrId: string) {
  if (!urlOrId) return "";
  if (/docs.google.com\/spreadsheets\/d\//.test(urlOrId)) {
    const m = urlOrId.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m?.[1] || "";
  }
  return urlOrId;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();
  await dbConnect();
  const user = await User.findOne({ email: userEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  // GET -> list saved links for UI/debug
  if (req.method === "GET") {
    const gs: any = (user as any).googleSheets || {};
    return res.status(200).json({ sheets: gs.syncedSheets || [] });
  }

  // POST -> create/update a link
  const {
    spreadsheetId: bodySpreadsheetId,
    spreadsheetUrl,
    title,
    sheetId,
    headerRow = 1,
    mapping = {},
    skip = {},
    folderName,
    folderId,
  } = (req.body || {}) as Body;

  const spreadsheetId = parseSpreadsheetId(bodySpreadsheetId || spreadsheetUrl || "");
  if (!spreadsheetId) return res.status(400).json({ message: "Missing spreadsheetId or spreadsheetUrl" });

  // OAuth from saved tokens
  const gs: any = (user as any).googleSheets || {};
  const legacy: any = (user as any).googleTokens || {};
  const tok = gs?.refreshToken ? gs : legacy?.refreshToken ? legacy : null;
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

  // Resolve tab meta (sheetId <-> title)
  let resolvedTitle = title;
  let resolvedSheetId = sheetId;
  try {
    const meta = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title))",
    });
    const tabs = meta.data.sheets || [];
    if (resolvedSheetId != null && !resolvedTitle) {
      resolvedTitle = tabs.find(t => t.properties?.sheetId === resolvedSheetId)?.properties?.title || undefined;
    } else if (resolvedTitle && resolvedSheetId == null) {
      resolvedSheetId = tabs.find(t => t.properties?.title === resolvedTitle)?.properties?.sheetId || undefined;
    }
    if (!resolvedTitle && tabs[0]?.properties?.title) {
      resolvedTitle = tabs[0].properties!.title!;
      resolvedSheetId = tabs[0].properties!.sheetId!;
    }
  } catch {
    return res.status(400).json({ message: "Unable to read spreadsheet metadata" });
  }
  if (!resolvedTitle) return res.status(400).json({ message: "Missing tab title and unable to resolve" });

  // Ensure/create Folder
  let folderDoc: any = null;
  if (folderId) {
    try {
      folderDoc = await Folder.findOne({
        _id: new mongoose.Types.ObjectId(folderId),
        userEmail,
      });
    } catch { /* ignore */ }
  }
  if (!folderDoc) {
    let baseName = folderName;
    if (!baseName) {
      const f = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
      baseName = `Google Sheet — ${f.data.name} — ${resolvedTitle}`;
    }
    folderDoc = await Folder.findOneAndUpdate(
      { userEmail, name: baseName },
      { $setOnInsert: { userEmail, name: baseName, source: "google-sheets" } },
      { new: true, upsert: true }
    );
  }

  // Build normalized link
  const link = {
    spreadsheetId,
    title: resolvedTitle,
    sheetId: resolvedSheetId,
    headerRow,
    mapping,
    skip,
    folderId: folderDoc._id,
    folderName: folderDoc.name,
    lastRowImported: headerRow, // pointer starts at header row; next run imports the first data row
    lastImportedAt: new Date(),
  };

  // Ensure googleSheets object and save
  if (!(user as any).googleSheets) {
    (user as any).googleSheets = {
      accessToken: tok.accessToken || "",
      refreshToken: tok.refreshToken || "",
      expiryDate: tok.expiryDate || 0,
      googleEmail: gs.googleEmail || legacy.googleEmail || userEmail,
      syncedSheets: [],
    };
  }
  const arr: any[] = (user as any).googleSheets.syncedSheets || [];
  const ix = arr.findIndex((s: any) =>
    s.spreadsheetId === spreadsheetId &&
    (s.sheetId === resolvedSheetId || s.title === resolvedTitle)
  );
  if (ix >= 0) arr[ix] = { ...arr[ix], ...link };
  else arr.push(link);
  (user as any).googleSheets.syncedSheets = arr;

  await user.save();
  return res.status(200).json({ ok: true, link });
}

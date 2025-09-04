// /pages/api/sheets/import-now.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { google } from "googleapis";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

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
function headerMap(headers: string[], row: any[]) {
  const obj: Record<string, any> = {};
  headers.forEach((h, i) => (obj[h] = row[i]));
  return obj;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const userEmail = session.user.email.toLowerCase();

  const { sheetId, tabName, folderName } = (req.body || {}) as {
    sheetId?: string;
    tabName?: string;
    folderName?: string;
  };
  if (!sheetId || !folderName) {
    return res.status(400).json({ error: "Missing sheetId or folderName" });
  }
  if (isSystemFolder(folderName)) {
    return res.status(400).json({ error: "Cannot import into system folders" });
  }

  await dbConnect();
  const user = await User.findOne({ email: userEmail });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Ensure/find destination Folder (by name) and block system folders
  const folderDoc = await Folder.findOneAndUpdate(
    { userEmail, name: folderName.trim() },
    { $setOnInsert: { userEmail, name: folderName.trim(), source: "google-sheets" } },
    { upsert: true, new: true }
  );
  if (!folderDoc) return res.status(400).json({ error: "Folder not found/created" });
  if (isSystemFolder(folderDoc.name)) {
    return res.status(400).json({ error: "Cannot import into system folders" });
  }

  const gs = (user as any).googleSheets || (user as any).googleTokens || {};
  if (!gs?.refreshToken) {
    return res.status(400).json({ error: "Google Sheets not connected" });
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
      `${process.env.NEXTAUTH_URL}/api/connect/google-sheets/callback`
  );
  oauth2Client.setCredentials({
    access_token: gs.accessToken || undefined,
    refresh_token: gs.refreshToken || undefined,
    expiry_date: gs.expiryDate || undefined,
  });

  const sheets = google.sheets({ version: "v4", auth: oauth2Client });

  // Resolve sheet/tab title
  let resolvedTab = tabName;
  if (!resolvedTab) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets(properties/title)" });
    resolvedTab = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
  }
  const safeTab = `'${escapeA1Title(resolvedTab!)}'!A:Z`;

  // Read rows
  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: safeTab,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const rows = valuesResp.data.values || [];
  if (rows.length < 2) {
    return res.status(200).json({
      inserted: 0,
      updated: 0,
      imported: 0,
      message: "No data rows",
      tab: resolvedTab,
      headers: rows[0] || [],
      folderId: String(folderDoc._id),
      folderName: String(folderDoc.name),
    });
  }

  const headers = rows[0].map((h: any) => String(h ?? "").trim());
  let inserted = 0;
  let updated = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((v: any) => v === "" || v === null || v === undefined)) continue;

    const obj = headerMap(headers, r);

    const firstName =
      obj["First Name"] || obj["firstName"] || obj["first_name"] || "";
    const lastName =
      obj["Last Name"] || obj["lastName"] || obj["last_name"] || "";
    const emailRaw = obj["Email"] || obj["email"] || "";
    const phoneRaw = obj["Phone"] || obj["phone"] || obj["Phone Number"] || "";
    const state = obj["State"] || obj["state"] || "";
    const notes = obj["Notes"] || obj["notes"] || "";
    const age = obj["Age"] || obj["age"] || "";

    const phoneKey = last10(String(phoneRaw));
    const emailLower = lcEmail(emailRaw);

    // Require at least one identifier
    if (!phoneKey && !emailLower) continue;

    // Build de-dupe filter across ALL mirrors
    const or: any[] = [];
    if (phoneKey) or.push({ phoneLast10: phoneKey }, { normalizedPhone: phoneKey });
    if (emailLower) or.push({ Email: emailLower }, { email: emailLower });
    const filter = { userEmail, ...(or.length ? { $or: or } : {}) };

    const setOnInsert: any = { createdAt: new Date() };
    const set: any = {
      userEmail,
      ownerEmail: userEmail,
      folderId: folderDoc._id,
      folder_name: String(folderDoc.name),
      "Folder Name": String(folderDoc.name),
      status: "New",
      "First Name": firstName,
      "Last Name": lastName,
      Email: emailLower || undefined,
      email: emailLower || undefined,
      Phone: String(phoneRaw || ""),
      phoneLast10: phoneKey || undefined,
      normalizedPhone: phoneKey || undefined,
      State: state || undefined,
      Notes: notes || undefined,
      Age: age !== "" && age !== null && age !== undefined ? Number(age) : undefined,
      updatedAt: new Date(),
      source: "google-sheets",
      sourceSpreadsheetId: sheetId,
      sourceTabTitle: resolvedTab,
    };

    const result = await (Lead as any).updateOne(filter, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });
    const upc = result?.upsertedCount || (result?.upsertedId ? 1 : 0) || 0;
    const mod = result?.modifiedCount || 0;
    const match = result?.matchedCount || 0;

    if (upc > 0) inserted += upc;
    else if (mod > 0 || match > 0) updated += 1;
  }

  // Optional: record last sync time (best effort)
  try {
    const arr = Array.isArray((user as any).googleSheets?.sheets)
      ? (user as any).googleSheets.sheets
      : [];
    const idx = arr.findIndex((s: any) => s.sheetId === sheetId);
    if (idx >= 0) {
      arr[idx].lastSyncedAt = new Date();
      (user as any).googleSheets.sheets = arr;
      await user.save();
    }
  } catch {
    // non-fatal
  }

  const imported = inserted + updated;

  return res.status(200).json({
    inserted,
    updated,
    imported,
    tab: resolvedTab,
    headers,
    folderId: String(folderDoc._id),
    folderName: String(folderDoc.name),
  });
}

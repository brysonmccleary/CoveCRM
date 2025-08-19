// /pages/api/sheets/import-now.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Lead from "@/models/Lead";
import { google } from "googleapis";

function last10(s?: string) {
  const d = String(s || "").replace(/\D+/g, "");
  return d.slice(-10) || "";
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

  const { sheetId, tabName, folderName } = req.body || {};
  if (!sheetId || !folderName) {
    return res.status(400).json({ error: "Missing sheetId or folderName" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const gs = (user as any).googleSheets || {};
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

  // Resolve the tab (sheet) name
  let resolvedTab = tabName;
  if (!resolvedTab) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    resolvedTab = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
  }

  // Read rows
  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const rows = valuesResp.data.values || [];
  if (rows.length < 2) {
    return res.status(200).json({ imported: 0, message: "No data rows" });
  }

  const headers = rows[0].map((h: any) => String(h).trim());
  let imported = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.every((v: any) => v === "" || v === null || v === undefined)) continue;

    const obj = headerMap(headers, r);

    const firstName =
      obj["First Name"] || obj["firstName"] || obj["first_name"] || "";
    const lastName =
      obj["Last Name"] || obj["lastName"] || obj["last_name"] || "";
    const email = obj["Email"] || obj["email"] || "";
    const phone = obj["Phone"] || obj["phone"] || obj["Phone Number"] || "";
    const state = obj["State"] || obj["state"] || "";
    const notes = obj["Notes"] || obj["notes"] || "";
    const age = obj["Age"] || obj["age"] || "";

    const phoneKey = last10(String(phone));

    // Idempotent upsert by (userEmail + phoneLast10) or (userEmail + email)
    const query: any = { userEmail: session.user.email };
    if (phoneKey) query.phoneLast10 = phoneKey;
    else if (email) query.Email = email;
    else continue; // discard if no identifier

    const update: any = {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        userEmail: session.user.email,
        folderName,
        "First Name": firstName,
        "Last Name": lastName,
        Email: email,
        Phone: String(phone || ""),
        State: state,
        Notes: notes,
        Age: age ? Number(age) : undefined,
        updatedAt: new Date(),
      },
    };

    const resDoc = await Lead.findOneAndUpdate(query, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });

    if (resDoc) imported += 1;
  }

  // Mark last sync for this sheet
  const arr = Array.isArray((user as any).googleSheets?.sheets)
    ? (user as any).googleSheets.sheets
    : [];
  const idx = arr.findIndex((s: any) => s.sheetId === sheetId);
  if (idx >= 0) {
    arr[idx].lastSyncedAt = new Date();
    (user as any).googleSheets.sheets = arr;
    await user.save();
  }

  res.status(200).json({ imported, tab: resolvedTab, headers });
}

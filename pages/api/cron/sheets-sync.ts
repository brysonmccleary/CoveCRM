// /pages/api/cron/sheets-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
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

async function importOneSheet(user: any, sheetId: string, folderName: string, tabName?: string) {
  const gs = user.googleSheets || {};
  if (!gs?.refreshToken) return { imported: 0, reason: "no refresh token" };

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

  let resolvedTab = tabName;
  if (!resolvedTab) {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    resolvedTab = meta.data.sheets?.[0]?.properties?.title || "Sheet1";
  }

  const valuesResp = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${resolvedTab}!A:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
    dateTimeRenderOption: "FORMATTED_STRING",
  });

  const rows = valuesResp.data.values || [];
  if (rows.length < 2) return { imported: 0, reason: "no data rows" };

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
    const query: any = { userEmail: user.email };
    if (phoneKey) query.phoneLast10 = phoneKey;
    else if (email) query.Email = email;
    else continue;

    const update: any = {
      $setOnInsert: { createdAt: new Date() },
      $set: {
        userEmail: user.email,
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

  return { imported, tab: resolvedTab };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Protect with a secret if you like: /api/cron/sheets-sync?token=XYZ
  const token = req.query.token as string | undefined;
  if (process.env.VERCEL_CRON_SECRET && token !== process.env.VERCEL_CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();

  const users = await User.find({ "googleSheets.sheets.0": { $exists: true } }).lean();
  let totalImported = 0;

  for (const u of users) {
    const sheetsCfg = (u as any).googleSheets?.sheets || [];
    for (const cfg of sheetsCfg) {
      const { sheetId, folderName, tabName } = cfg;
      if (!sheetId || !folderName) continue;

      try {
        const r = await importOneSheet(u, sheetId, folderName, tabName);
        totalImported += r.imported || 0;
      } catch (e) {
        console.warn("[sheets-sync] failed for", u.email, sheetId, e);
      }
    }
  }

  res.status(200).json({ ok: true, totalImported });
}

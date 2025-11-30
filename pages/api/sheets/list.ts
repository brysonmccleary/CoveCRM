// /pages/api/sheets/list.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const email = session.user.email.toLowerCase();

  await dbConnect();
  const user = await User.findOne({ email }).lean<any>();

  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  const sheets = user.googleSheets || {};
  const tokens = user.googleTokens || {};
  const calendar = user.googleCalendar || {};

  // Prefer Sheets tokens, then shared, then calendar
  const refreshToken: string | undefined =
    sheets.refreshToken || tokens.refreshToken || calendar.refreshToken || undefined;

  const accessToken: string | undefined =
    sheets.accessToken || tokens.accessToken || calendar.accessToken || undefined;

  const expiryRaw =
    typeof sheets.expiryDate === "number"
      ? sheets.expiryDate
      : typeof tokens.expiryDate === "number"
      ? tokens.expiryDate
      : typeof calendar.expiryDate === "number"
      ? calendar.expiryDate
      : undefined;

  if (!refreshToken && !accessToken) {
    return res.status(400).json({ error: "Google Sheets not connected" });
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${base.replace(/\/$/, "")}/api/connect/google-sheets/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken,
    expiry_date: expiryRaw,
  });

  // Try to refresh if we have a refresh token and we're close to / past expiry.
  if (refreshToken) {
    const needsRefresh = !expiryRaw || Date.now() >= expiryRaw - 120_000; // 2-min buffer
    if (needsRefresh) {
      try {
        // Same pattern you use in googleCalendarClient
        const { credentials } = await (oauth2Client as any).refreshAccessToken();
        oauth2Client.setCredentials(credentials);

        // Persist back to googleSheets so future calls don't depend on calendar/googleTokens
        await User.updateOne(
          { email },
          {
            $set: {
              "googleSheets.accessToken": credentials.access_token || accessToken || "",
              "googleSheets.refreshToken": refreshToken,
              "googleSheets.expiryDate": credentials.expiry_date || expiryRaw || null,
            },
          }
        );
      } catch (err: any) {
        console.error("Sheets token refresh failed:", err?.message || err);
        // If refresh fails, we'll still TRY with existing accessToken if present.
      }
    }
  }

  const drive = google.drive({ version: "v3", auth: oauth2Client });

  try {
    const q = "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    const r = await drive.files.list({
      q,
      fields: "files(id,name,modifiedTime,owners(emailAddress))",
      pageSize: 100,
      orderBy: "modifiedTime desc",
    });

    return res.status(200).json({ files: r.data.files || [] });
  } catch (err: any) {
    console.error("Drive list error:", err?.errors || err?.message || err);
    const message = err?.errors?.[0]?.message || err?.message || "Drive list failed";
    return res.status(500).json({ error: message });
  }
}

// pages/api/google/sheets/list-tabs.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

function getBase(req: NextApiRequest) {
  const host =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";

  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `${proto}://${host}`
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const spreadsheetId = String(req.query.spreadsheetId || "");
    if (!spreadsheetId) {
      return res.status(400).json({ error: "Missing spreadsheetId" });
    }

    await dbConnect();

    const email = session.user.email.toLowerCase();
    const user = await User.findOne({ email }).lean<any>();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const sheetsTokens = user.googleSheets || {};
    const sharedTokens = user.googleTokens || {};
    const calendarTokens = user.googleCalendar || {};

    // Prefer Sheets tokens, then shared, then calendar (same pattern as /api/sheets/list)
    const refreshToken: string | undefined =
      sheetsTokens.refreshToken ||
      sharedTokens.refreshToken ||
      calendarTokens.refreshToken ||
      undefined;

    const accessToken: string | undefined =
      sheetsTokens.accessToken ||
      sharedTokens.accessToken ||
      calendarTokens.accessToken ||
      undefined;

    const expiryRaw =
      typeof sheetsTokens.expiryDate === "number"
        ? sheetsTokens.expiryDate
        : typeof sharedTokens.expiryDate === "number"
        ? sharedTokens.expiryDate
        : typeof calendarTokens.expiryDate === "number"
        ? calendarTokens.expiryDate
        : undefined;

    if (!refreshToken && !accessToken) {
      return res.status(400).json({ error: "Google Sheets not connected" });
    }

    const base = getBase(req);
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI_SHEETS ||
      `${base.replace(/\/$/, "")}/api/connect/google-sheets/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri,
    );

    oauth2.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken,
      expiry_date: expiryRaw,
    });

    // Try to refresh if needed (mirrors /api/sheets/list)
    if (refreshToken) {
      const needsRefresh = !expiryRaw || Date.now() >= expiryRaw - 120_000;
      if (needsRefresh) {
        try {
          const { credentials } = await (oauth2 as any).refreshAccessToken();
          oauth2.setCredentials(credentials);

          await User.updateOne(
            { email },
            {
              $set: {
                "googleSheets.accessToken":
                  credentials.access_token || accessToken || "",
                "googleSheets.refreshToken": refreshToken,
                "googleSheets.expiryDate":
                  credentials.expiry_date || expiryRaw || null,
              },
            },
          );
        } catch (err: any) {
          console.error(
            "Sheets list-tabs token refresh failed:",
            err?.message || err,
          );
          // carry on with existing access token if we have one
        }
      }
    }

    const sheetsApi = google.sheets({ version: "v4", auth: oauth2 });
    const { data } = await sheetsApi.spreadsheets.get({
      spreadsheetId,
      fields: "sheets(properties(sheetId,title,index))",
    });

    const tabs = (data.sheets || []).map((s) => ({
      sheetId: s.properties?.sheetId,
      title: s.properties?.title,
      index: s.properties?.index,
    }));

    return res.status(200).json({ tabs });
  } catch (err: any) {
    console.error(
      "Sheets list-tabs error:",
      err?.errors || err?.message || err,
    );
    const message =
      err?.errors?.[0]?.message ||
      err?.response?.data?.error?.message ||
      err?.message ||
      "Sheets list-tabs failed";
    return res.status(500).json({ error: message });
  }
}

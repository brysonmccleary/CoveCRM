import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

function baseUrl(req: NextApiRequest) {
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  return process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const spreadsheetId = String(req.query.spreadsheetId || "");
  if (!spreadsheetId) return res.status(400).json({ error: "Missing spreadsheetId" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email.toLowerCase() }).lean<any>();

  // Prefer googleSheets, fallback to googleTokens (back-compat)
  const gs = user?.googleSheets || user?.googleTokens || {};
  if (!gs?.refreshToken) return res.status(400).json({ error: "Google not connected" });

  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI_SHEETS ||
    `${baseUrl(req)}/api/connect/google-sheets/callback`;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );
  oauth2.setCredentials({
    access_token: gs.accessToken || undefined,
    refresh_token: gs.refreshToken || undefined,
    expiry_date: gs.expiryDate || undefined,
  });

  const sheets = google.sheets({ version: "v4", auth: oauth2 });
  const { data } = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,index))",
  });

  const tabs = (data.sheets || []).map((s) => ({
    sheetId: s.properties?.sheetId,
    title: s.properties?.title,
    index: s.properties?.index,
  }));

  return res.status(200).json({ tabs });
}

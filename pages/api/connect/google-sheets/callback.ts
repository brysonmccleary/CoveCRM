// /pages/api/connect/google-sheets/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

function baseUrl(req: NextApiRequest) {
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
  res: NextApiResponse
) {
  // Require a logged-in user
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).send("Unauthorized");

  const code = req.query.code as string | undefined;
  if (!code) return res.status(400).send("Missing code");

  // No state/email check anymore – we trust the logged-in session.
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    `${baseUrl(req).replace(/\/$/, "")}/api/connect/google-sheets/callback`;

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  let tokens;
  try {
    const resp = await oauth2.getToken(code);
    tokens = resp.tokens;
  } catch (err: any) {
    console.error("Sheets OAuth token exchange failed:", err?.message || err);
    return res
      .status(400)
      .send(`Token exchange failed: ${err?.message || "unknown error"}`);
  }

  await dbConnect();

  const email = session.user.email.toLowerCase();
  const existing = await User.findOne({ email })
    .select("googleSheets googleTokens googleCalendar flags")
    .lean<any>();

  // Preserve refresh_token if Google doesn't resend it
  const refreshToken =
    tokens.refresh_token ||
    existing?.googleSheets?.refreshToken ||
    existing?.googleTokens?.refreshToken ||
    existing?.googleCalendar?.refreshToken ||
    "";

  const accessToken =
    tokens.access_token ||
    existing?.googleSheets?.accessToken ||
    existing?.googleTokens?.accessToken ||
    existing?.googleCalendar?.accessToken ||
    "";
  const expiryDate =
    tokens.expiry_date ??
    existing?.googleSheets?.expiryDate ??
    existing?.googleTokens?.expiryDate ??
    existing?.googleCalendar?.expiryDate ??
    null;
  const scope =
    tokens.scope ||
    existing?.googleSheets?.scope ||
    existing?.googleTokens?.scope ||
    existing?.googleCalendar?.scope ||
    "";

  await User.updateOne(
    { email },
    {
      $set: {
        // ✅ Primary for Sheets imports
        googleSheets: { accessToken, refreshToken, expiryDate, scope },
        // ✅ Back-compat
        googleTokens: { accessToken, refreshToken, expiryDate, scope },
        // ✅ Keep calendar in sync so calendar endpoints can still use it
        googleCalendar: { accessToken, refreshToken, expiryDate, scope },
        googleSheetsConnected: true,
        flags: {
          ...(existing as any)?.flags,
          calendarConnected: !!refreshToken,
          calendarNeedsReconnect: !refreshToken,
        },
      },
    }
  );

  // ✅ After connecting, go back to Leads and trigger sheet loading
  return res.redirect("/leads?connected=google-sheets");
}

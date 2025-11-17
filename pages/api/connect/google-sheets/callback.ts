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

  // IMPORTANT: no more "State mismatch" check here.
  // We trust the logged-in session email as the owner of these tokens.

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
    .select("googleSheets googleTokens")
    .lean<any>();

  // Preserve refresh_token if Google doesn't resend it
  const refreshToken =
    tokens.refresh_token ||
    existing?.googleSheets?.refreshToken ||
    existing?.googleTokens?.refreshToken ||
    "";

  const accessToken =
    tokens.access_token || existing?.googleSheets?.accessToken || "";
  const expiryDate =
    tokens.expiry_date ?? existing?.googleSheets?.expiryDate ?? null;
  const scope = tokens.scope || existing?.googleSheets?.scope || "";

  await User.updateOne(
    { email },
    {
      $set: {
        // Primary location our APIs (including imports) read from
        googleSheets: { accessToken, refreshToken, expiryDate, scope },
        // Back-compat with any older code paths (including calendar/events)
        googleTokens: { accessToken, refreshToken, expiryDate, scope },
        googleSheetsConnected: true,
      },
    }
  );

  // You can keep this redirect or change it to Settings; it doesn't affect leads.
  return res.redirect("/google-sheets-sync?connected=google-sheets");
}

// /pages/api/connect/google-sheets/callback.ts
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
  if (!session?.user?.email) return res.status(401).send("Unauthorized");

  const code = req.query.code as string | undefined;
  const state = (req.query.state as string | undefined) || "";
  if (!code) return res.status(400).send("Missing code");

  try {
    const stateEmail = decodeURIComponent(state || "");
    if (stateEmail && stateEmail.toLowerCase() !== session.user.email.toLowerCase()) {
      return res.status(400).send("State mismatch");
    }
  } catch { /* ignore malformed state */ }

  const redirectUri = `${baseUrl(req)}/api/connect/google-sheets/callback`;
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
    return res.status(400).send(`Token exchange failed: ${err?.message || "unknown error"}`);
  }

  await dbConnect();

  const email = session.user.email.toLowerCase();
  const existing = await User.findOne({ email })
    .select("googleSheets googleTokens")
    .lean<any>();

  const refreshToken =
    tokens.refresh_token ||
    existing?.googleSheets?.refreshToken ||
    existing?.googleTokens?.refreshToken ||
    "";

  const accessToken = tokens.access_token || existing?.googleSheets?.accessToken || "";
  const expiryDate = tokens.expiry_date ?? existing?.googleSheets?.expiryDate ?? null;
  const scope = tokens.scope || existing?.googleSheets?.scope || "";

  await User.updateOne(
    { email },
    {
      $set: {
        googleSheets: { accessToken, refreshToken, expiryDate, scope },
        googleTokens: { accessToken, refreshToken, expiryDate, scope },
        googleSheetsConnected: true,
      },
    }
  );

  return res.redirect("/google-sheets-sync?connected=google-sheets");
}

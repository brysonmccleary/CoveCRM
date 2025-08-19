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

  const code = req.query.code as string;
  if (!code) return res.status(400).send("Missing code");

  const redirectUri = `${baseUrl(req)}/api/connect/google-sheets/callback`;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri
  );

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);

  // Try to fetch the Google account email (optional but nice for debugging)
  let googleEmail = "";
  try {
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2 });
    const me = await oauth2Api.userinfo.get();
    googleEmail = me.data.email || "";
  } catch {
    // ignore
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email.toLowerCase() }).lean();

  // Preserve previous refresh token if Google doesn't return it on re-consent
  const existingRefresh = (user as any)?.googleSheets?.refreshToken || "";

  await User.updateOne(
    { email: session.user.email.toLowerCase() },
    {
      $set: {
        googleSheets: {
          accessToken: tokens.access_token || (user as any)?.googleSheets?.accessToken || "",
          refreshToken: tokens.refresh_token || existingRefresh,
          expiryDate: tokens.expiry_date ?? (user as any)?.googleSheets?.expiryDate ?? null,
          scope: tokens.scope || (user as any)?.googleSheets?.scope || "",
          googleEmail,
          // Keep any existing sync metadata if present
          syncedSheets: (user as any)?.googleSheets?.syncedSheets || [],
        },
      },
    },
    { upsert: false }
  );

  return res.redirect("/dashboard?tab=leads");
}

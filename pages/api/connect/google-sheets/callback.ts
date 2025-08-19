import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]"; // <-- note: ../../ not ../
import { updateUserGoogleSheets } from "@/lib/userHelpers";

function getBaseUrl(req: NextApiRequest) {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.VERCEL ? "https" : "http");
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host;
  if (proto && host) return `${proto}://${host}`;
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000"
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const code = (req.query.code as string) || "";
    if (!code) {
      return res.status(400).json({ error: "Missing authorization code" });
    }

    // Must match the redirect used in the start route
    const base = getBaseUrl(req);
    const redirectUri = `${base}/api/connect/google-sheets/callback`;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);

    // Save to your user document
    await updateUserGoogleSheets(session.user.email, {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "", // may be empty if Google didn't return it this time
      expiryDate: tokens.expiry_date ?? null,
    });

    return res.redirect("/dashboard?tab=settings#sheets=connected");
  } catch (err: any) {
    console.error("Sheets OAuth callback error:", err?.response?.data || err);
    return res.redirect("/dashboard?tab=settings#sheets=error");
  }
}

// /pages/api/google-auth/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";
    const redirectUri = `${base}/api/google-auth/callback`;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    await dbConnect();
    const userDoc = await User.findOne({ email: session.user.email });

    // If Google didn't return a refresh token (common on re-consent), keep any existing one
    const existingRefresh =
      (userDoc as any)?.googleSheets?.refreshToken ||
      (userDoc as any)?.googleTokens?.refreshToken ||
      "";

    const refreshToken = tokens.refresh_token || existingRefresh || "";

    // Build updates for BOTH legacy shapes (your UI might read either)
    const updates: any = {
      googleSheets: {
        accessToken: tokens.access_token || (userDoc as any)?.googleSheets?.accessToken || "",
        refreshToken,
        expiryDate: tokens.expiry_date ?? (userDoc as any)?.googleSheets?.expiryDate ?? null,
        googleEmail: (userDoc as any)?.googleSheets?.googleEmail || session.user.email,
      },
      googleTokens: {
        accessToken: tokens.access_token || (userDoc as any)?.googleTokens?.accessToken || "",
        refreshToken,
        expiryDate: tokens.expiry_date ?? (userDoc as any)?.googleTokens?.expiryDate ?? null,
      },
    };

    // Give the app a sensible default if none set yet
    if (!(userDoc as any)?.calendarId) {
      updates.calendarId = "primary";
    }

    await User.updateOne({ email: session.user.email }, { $set: updates });

    // Back to settings (or anywhere you want)
    return res.redirect("/dashboard?tab=settings");
  } catch (err: any) {
    console.error("Google OAuth callback error:", err?.response?.data || err);
    return res.status(500).json({ error: "Google OAuth callback failed" });
  }
}

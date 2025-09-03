// pages/api/connect/google-calendar/callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { updateUserGoogleSheets } from "@/lib/userHelpers";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const code = req.query.code as string;
    if (!code) return res.status(400).json({ error: "Missing authorization code" });

    const base =
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://localhost:3000";

    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      `${base.replace(/\/$/, "")}/api/connect/google-calendar/callback`;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri
    );

    const { tokens } = await oauth2.getToken(code);

    // Save (helper you already use)
    await updateUserGoogleSheets(email, {
      accessToken: tokens.access_token || "",
      refreshToken: tokens.refresh_token || "",
      expiryDate: tokens.expiry_date ?? null,
    });

    // Also save in googleTokens for calendar/event readers
    await dbConnect();
    const current = await User.findOne({ email }).lean<{ googleTokens?: any; googleSheets?: any; googleCalendar?: any }>();
    const fallbackRefresh =
      tokens.refresh_token ||
      current?.googleTokens?.refreshToken ||
      current?.googleSheets?.refreshToken ||
      current?.googleCalendar?.refreshToken ||
      "";

    await User.findOneAndUpdate(
      { email },
      {
        $set: {
          googleTokens: {
            accessToken: tokens.access_token || current?.googleTokens?.accessToken || "",
            refreshToken: fallbackRefresh,
            expiryDate: tokens.expiry_date ?? current?.googleTokens?.expiryDate ?? null,
          },
        },
      }
    );

    return res.redirect("/dashboard?tab=settings");
  } catch (err: any) {
    console.error("Calendar OAuth callback error:", err?.response?.data || err);
    return res.status(500).json({ error: "Calendar OAuth callback failed" });
  }
}

// pages/api/connect/google-calendar/disconnect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Collect any tokens we might have stored (in all legacy locations)
  const tokens: string[] = [
    (user as any)?.googleTokens?.accessToken,
    (user as any)?.googleTokens?.refreshToken,
    (user as any)?.googleSheets?.accessToken,
    (user as any)?.googleSheets?.refreshToken,
    (user as any)?.googleCalendar?.accessToken,
    (user as any)?.googleCalendar?.refreshToken,
  ].filter(Boolean) as string[];

  // Best-effort revoke with Google (safe to ignore individual failures)
  try {
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    await Promise.all(
      tokens.map(async (t) => {
        try {
          await oauth2.revokeToken(t);
        } catch {
          /* ignore */
        }
      }),
    );
  } catch {
    /* ignore */
  }

  // Hard-remove all stored Google auth for this user
  await User.updateOne(
    { email },
    {
      $unset: {
        googleTokens: "",
        googleSheets: "",
        googleCalendar: "",
        calendarId: "",
      },
      $set: {
        "flags.calendarConnected": false,
        "flags.calendarNeedsReconnect": true,
      },
    },
  );

  return res.status(200).json({ ok: true, revoked: tokens.length });
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // absolutely no caching while we fix this state
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");

  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    // Look only for REFRESH tokens across all legacy locations
    const googleTokens   = (user as any).googleTokens   || null;
    const googleCalendar = (user as any).googleCalendar || null;
    const googleSheets   = (user as any).googleSheets   || null;

    const hasGT = !!googleTokens?.refreshToken;
    const hasGC = !!googleCalendar?.refreshToken;
    const hasGS = !!googleSheets?.refreshToken;

    const hasRefreshToken = hasGT || hasGC || hasGS;

    // keep your original shape so the FE doesn’t break
    return res.status(200).json({
      calendarConnected: hasRefreshToken,      // ← ONLY true when a refresh token exists
      calendarId: (user as any).calendarId ?? null,
      googleCalendar: null
    });
  } catch (err) {
    console.error("❌ calendar-status error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

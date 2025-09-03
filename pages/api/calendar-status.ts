// pages/api/calendar-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getUserByEmail } from "@/models/User";
import dbConnect from "@/lib/mongooseConnect";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();
  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const googleCalendar = (user as any).googleCalendar || null;
    const googleSheets   = (user as any).googleSheets   || null;
    const googleTokens   = (user as any).googleTokens   || null;

    const hasGT = !!googleTokens?.refreshToken;
    const hasGC = !!googleCalendar?.refreshToken;
    const hasGS = !!googleSheets?.refreshToken;

    const hasRefreshToken = hasGT || hasGC || hasGS;

    return res.status(200).json({
      calendarConnected: hasRefreshToken,   // ✅ only true if a refresh token exists
      hasRefreshToken,
      sources: { hasGT, hasGC, hasGS },     // non-sensitive booleans to help us verify
    });
  } catch (err) {
    console.error("❌ Error checking calendar status:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

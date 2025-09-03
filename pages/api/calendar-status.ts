import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  const session = await getServerSession(req, res, authOptions);
  const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const googleTokens   = (user as any).googleTokens   || null;
    const googleCalendar = (user as any).googleCalendar || null;
    const googleSheets   = (user as any).googleSheets   || null;

    const hasRefreshToken =
      !!googleTokens?.refreshToken ||
      !!googleCalendar?.refreshToken ||
      !!googleSheets?.refreshToken;

    // ✅ Keep your original shape, but with correct boolean
    return res.status(200).json({
      calendarConnected: hasRefreshToken,
      calendarId: (user as any).calendarId ?? null,
      googleCalendar: null, // don't leak tokens; preserve key for compatibility
    });
  } catch (err) {
    console.error("❌ calendar-status error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

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
  if (!email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const googleCalendar = user.googleCalendar || null;
    const googleSheets = user.googleSheets || null;
    const googleTokens = (user as any).googleTokens || null;
    const calendarId = (user as any).calendarId || null;

    const accessToken =
      googleTokens?.accessToken ||
      googleCalendar?.accessToken ||
      googleSheets?.accessToken ||
      null;

    const refreshToken =
      googleTokens?.refreshToken ||
      googleCalendar?.refreshToken ||
      googleSheets?.refreshToken ||
      null;

    return res.status(200).json({
      // "Connected" if we have at least one token saved
      calendarConnected: !!(accessToken || refreshToken),
      // Extra signal many UIs use to show "reconnect" when refresh is missing
      hasRefreshToken: !!refreshToken,
      calendarId,
      // keep existing key for forward compatibility
      googleCalendar,
    });
  } catch (err) {
    console.error("❌ Error checking calendar status:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // absolutely no caching while we fix this state
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

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

    // Look only for REFRESH tokens across legacy locations.
    const googleTokens = (user as any).googleTokens || null;
    const googleCalendar = (user as any).googleCalendar || null;
    const googleSheets = (user as any).googleSheets || null;

    // Support both refreshToken and refresh_token shapes.
    const hasGT =
      !!(googleTokens?.refreshToken || googleTokens?.refresh_token);
    const hasGC =
      !!(googleCalendar?.refreshToken || googleCalendar?.refresh_token);
    const hasGS =
      !!(googleSheets?.refreshToken || googleSheets?.refresh_token);

    // ❗ For CALENDAR status, sheets-only tokens do NOT count.
    const hasRefreshToken = hasGC || hasGT;

    // keep your original shape so the FE doesn’t break
    return res.status(200).json({
      calendarConnected: hasRefreshToken, // ← true only when a calendar-capable token exists
      calendarId: (user as any).calendarId ?? null,
      googleCalendar: null,
    });
  } catch (err) {
    console.error("❌ calendar-status error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

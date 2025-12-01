// /pages/api/calendar-status.ts
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

    const u: any = user;

    // Legacy token locations
    const googleTokens = u.googleTokens || null;
    const googleCalendar = u.googleCalendar || null;
    const integrations = u.integrations || {};
    const integrationsCalendar = integrations.googleCalendar || null;

    // Support both refreshToken and refresh_token shapes.
    const hasGT =
      !!(googleTokens?.refreshToken || googleTokens?.refresh_token);
    const hasGC =
      !!(googleCalendar?.refreshToken || googleCalendar?.refresh_token);
    const hasIC =
      !!(
        integrationsCalendar?.refreshToken ||
        integrationsCalendar?.refresh_token
      );

    // ❗ For CALENDAR status, sheets-only tokens do NOT count.
    const hasRefreshToken = hasGC || hasGT || hasIC;

    const flags = u.flags || {};
    const calendarNeedsReconnect = !!flags.calendarNeedsReconnect;
    const calendarConnectedFlag = !!flags.calendarConnected;

    // Derive final "connected" state:
    // - if we know we need reconnect → false
    // - else if we still have a calendar-capable refresh token → true
    // - else fall back to false
    const calendarConnected =
      !calendarNeedsReconnect && hasRefreshToken && !calendarConnectedFlag
        ? true
        : !calendarNeedsReconnect && (calendarConnectedFlag || hasRefreshToken);

    return res.status(200).json({
      calendarConnected,
      calendarId: u.calendarId ?? null,
      needsReconnect: calendarNeedsReconnect || !hasRefreshToken,
      // keep googleCalendar shape so FE doesn't break even though we don't expose tokens
      googleCalendar: null,
    });
  } catch (err) {
    console.error("❌ calendar-status error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

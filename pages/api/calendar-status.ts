import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { getUserByEmail } from "@/models/User";
import dbConnect from "@/lib/mongooseConnect";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();
  const session = await getServerSession(req, res, authOptions);

  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const googleCalendar = user.googleCalendar || null;
    const googleSheets = user.googleSheets || null;
    const calendarId = user.calendarId || null;

    return res.status(200).json({
      calendarConnected: !!(
        googleCalendar?.accessToken || googleSheets?.accessToken
      ),
      calendarId,
      googleCalendar, // optional – stays for future compatibility
    });
  } catch (err) {
    console.error("❌ Error checking calendar status:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

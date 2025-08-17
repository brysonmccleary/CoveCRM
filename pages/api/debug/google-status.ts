// /pages/api/debug/google-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import { google } from "googleapis";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;
const INTERNAL_API_TOKEN = process.env.INTERNAL_API_TOKEN || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).end();

  const bearer = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== INTERNAL_API_TOKEN) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { agentEmail } = req.query as { agentEmail?: string };
  if (!agentEmail) {
    return res.status(400).json({ message: "Missing agentEmail query param" });
  }

  await dbConnect();

  const user = await User.findOne({ email: String(agentEmail).toLowerCase() });
  if (!user) {
    return res.status(404).json({ message: "Agent not found" });
  }

  const refreshToken =
    (user as any)?.googleTokens?.refreshToken ||
    (user as any)?.googleSheets?.refreshToken;

  if (!refreshToken) {
    return res.status(400).json({
      message: "No Google refresh token found — connect Google in Settings first",
    });
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const calendar = google.calendar({ version: "v3", auth: oauth2Client });
    const list = await calendar.calendarList.list();

    return res.status(200).json({
      success: true,
      connected: true,
      calendars: list.data.items?.map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary,
      })),
    });
  } catch (err) {
    console.error("❌ Google status check error:", err);
    return res.status(500).json({
      success: false,
      message: "Google API error",
      error: (err as Error).message,
    });
  }
}

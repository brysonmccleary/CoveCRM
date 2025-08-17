// /pages/api/settings/detect-timezone.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";

function looksLikeIanaTz(tz?: string) {
  return !!tz && tz.includes("/") && tz.length <= 64;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email;
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  // 1) Prefer Vercel edge header if present
  const headerTz = (req.headers["x-vercel-ip-timezone"] as string | undefined) || undefined;

  // 2) Allow client-provided tz (from browser) as fallback
  const bodyTz = (req.body?.tz as string | undefined) || (req.query?.tz as string | undefined);

  const tz = [headerTz, bodyTz].find(looksLikeIanaTz);

  if (!tz) {
    return res.status(400).json({ message: "No valid timezone provided/detected" });
  }

  try {
    await dbConnect();

    await User.updateOne(
      { email: userEmail },
      { $set: { "bookingSettings.timezone": tz } }
    );

    return res.status(200).json({ success: true, timezone: tz });
  } catch (e) {
    console.error("detect-timezone error:", e);
    return res.status(500).json({ message: "Internal server error" });
  }
}
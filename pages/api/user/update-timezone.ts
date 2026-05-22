import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions as any);
  const email = String((session as any)?.user?.email || "").toLowerCase();
  if (!email) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { timezone } = (req.body || {}) as { timezone?: string };
  const tz = String(timezone || "").trim();

  if (!tz || !isValidIanaTimezone(tz)) {
    return res.status(400).json({ ok: false, error: "Invalid IANA timezone" });
  }

  await mongooseConnect();
  await User.updateOne(
    { email },
    { $set: { "bookingSettings.timezone": tz } }
  );

  return res.status(200).json({ ok: true });
}

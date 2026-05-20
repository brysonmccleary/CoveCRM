import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import mongooseConnect from "@/lib/mongooseConnect";
import AISettings from "@/models/AISettings";
import User from "@/models/User";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

const ALLOWED_FIELDS = [
  "aiTextingEnabled",
  "aiNewLeadCallEnabled",
  "aiDialSessionEnabled",
  "aiCallOverviewEnabled",
  "businessHoursOnly",
  "businessHoursStart",
  "businessHoursEnd",
  "businessHoursTimezone",
  "newLeadCallDelayMinutes",
] as const;

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const emailRaw = (
      payload?.email ||
      payload?.userEmail ||
      payload?.sub ||
      ""
    ).toString();
    const email = emailRaw.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const userEmail = getEmailFromAuth(req);
  if (!userEmail) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  try {
    await mongooseConnect();

    if (req.method === "GET") {
      const settings = await AISettings.findOne({ userEmail }).lean();
      return res.status(200).json({ ok: true, settings });
    }

    const user = await User.findOne({ email: userEmail })
      .select({ _id: 1 })
      .lean();
    if (!user) {
      return res.status(404).json({ ok: false, error: "User not found" });
    }

    const update: Record<string, any> = {};
    for (const field of ALLOWED_FIELDS) {
      if (field in (req.body || {})) update[field] = req.body[field];
    }

    const settings = await AISettings.findOneAndUpdate(
      { userEmail },
      {
        $set: update,
        $setOnInsert: { userEmail, userId: (user as any)._id },
      },
      { upsert: true, new: true },
    ).lean();

    return res.status(200).json({ ok: true, settings });
  } catch (error) {
    console.error("mobile/ai-settings error:", error);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
}

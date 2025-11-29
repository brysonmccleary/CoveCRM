// /pages/api/mobile/notifications/register.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import mongooseConnect from "@/lib/mongooseConnect";
import MobileDevice from "@/models/MobileDevice";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * POST /api/mobile/notifications/register
 * Auth: Bearer <mobile JWT>
 * Body: { expoPushToken: string; platform?: "ios" | "android" | "unknown"; deviceId?: string }
 *
 * Stores/updates a device record for push notifications.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const userEmail = getEmailFromAuth(req);
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const { expoPushToken, platform, deviceId } = (req.body || {}) as {
    expoPushToken?: string;
    platform?: "ios" | "android" | "unknown";
    deviceId?: string;
  };

  if (!expoPushToken || typeof expoPushToken !== "string") {
    return res.status(400).json({ error: "Missing or invalid expoPushToken" });
  }

  try {
    await mongooseConnect();

    const filter: any = {
      userEmail,
      expoPushToken,
    };

    if (deviceId) filter.deviceId = deviceId;

    const update = {
      userEmail,
      expoPushToken,
      platform: platform || "unknown",
      deviceId: deviceId || undefined,
      lastSeenAt: new Date(),
      disabled: false,
    };

    const doc = await MobileDevice.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }).lean();

    return res.status(200).json({ ok: true, device: doc });
  } catch (err) {
    console.error("mobile notifications register error:", err);
    return res.status(500).json({ error: "Server error" });
  }
}

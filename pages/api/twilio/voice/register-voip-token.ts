// /pages/api/twilio/voice/register-voip-token.ts
// Accept VoIP push tokens (APNS/FCM) from the mobile app, scoped by mobile JWT.
//
// Called by: registerVoipPushToken() in /covecrm-mobile/lib/voiceClient.ts
//
// Auth:
//   Authorization: Bearer <mobile JWT from /api/mobile/login>
//
// Behavior:
//   - Verifies mobile JWT (MOBILE_JWT_SECRET / NEXTAUTH_SECRET)
//   - Upserts a MobileVoipDevice row keyed by { userEmail, deviceId }
//   - Stores platform + voipToken + lastSeenAt
//   - Fully multi-tenant-safe via userEmail

import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import dbConnect from "@/lib/mongooseConnect";
import MobileVoipDevice from "@/models/MobileVoipDevice";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

type JwtPayload = {
  email?: string;
  sub?: string;
  [key: string]: any;
};

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as JwtPayload;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch (err) {
    console.warn("[twilio][voip] JWT verify failed:", err);
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = getEmailFromAuth(req);
  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { voipToken, deviceId, platform } = (req.body || {}) as {
    voipToken?: string;
    deviceId?: string;
    platform?: "ios" | "android" | string;
  };

  if (
    !voipToken ||
    typeof voipToken !== "string" ||
    !deviceId ||
    typeof deviceId !== "string" ||
    (platform !== "ios" && platform !== "android")
  ) {
    return res.status(400).json({
      error:
        "Missing or invalid voipToken, deviceId, or platform (must be 'ios' | 'android').",
    });
  }

  try {
    await dbConnect();

    const now = new Date();

    const doc = await MobileVoipDevice.findOneAndUpdate(
      { userEmail, deviceId },
      {
        userEmail,
        deviceId,
        platform,
        voipToken,
        lastSeenAt: now,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      },
    ).lean();

    console.log("[twilio][voip] register-voip-token upserted", {
      userEmail,
      deviceId,
      platform,
      hasToken: !!voipToken,
      lastSeenAt: now.toISOString(),
      id: doc?._id?.toString?.() || null,
    });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error(
      "[twilio][voip] register-voip-token error:",
      err?.message || err,
    );
    return res.status(500).json({ error: "Server error registering VoIP token" });
  }
}

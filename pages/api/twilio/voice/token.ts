// /pages/api/twilio/voice/token.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]"; // ✅ FIXED: Correct relative path
import twilio from "twilio";

const { AccessToken } = twilio.jwt;
const { VoiceGrant } = AccessToken as any;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.email) {
    console.error("❌ Session not found or user not authenticated");
    return res.status(401).json({ message: "Unauthorized" });
  }

  const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
  const API_KEY_SID =
    process.env.TWILIO_API_KEY_SID || process.env.TWILIO_API_KEY!;
  const API_KEY_SECRET = process.env.TWILIO_API_KEY_SECRET!;
  const OUTGOING_APP_SID =
    process.env.TWILIO_APP_SID || process.env.TWILIO_TWIML_APP_SID || "";

  if (!ACCOUNT_SID || !API_KEY_SID || !API_KEY_SECRET) {
    console.error("❌ Missing Twilio env vars for voice token");
    return res.status(500).json({ message: "Server voice config missing" });
  }

  try {
    const identity = session.user.email.toLowerCase();

    const token = new AccessToken(ACCOUNT_SID, API_KEY_SID, API_KEY_SECRET, {
      identity,
      ttl: 3600,
    });

    const voiceGrant = new VoiceGrant({
      incomingAllow: true,
      ...(OUTGOING_APP_SID ? { outgoingApplicationSid: OUTGOING_APP_SID } : {}),
    });

    token.addGrant(voiceGrant);

    return res.status(200).json({
      token: token.toJwt(),
      identity,
    });
  } catch (err) {
    console.error("❌ Error generating voice token:", err);
    return res.status(500).json({ message: "Unable to generate token" });
  }
}

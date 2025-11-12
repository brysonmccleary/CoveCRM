// /pages/api/twilio/token.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import twilio from "twilio";

const AccessToken = twilio.jwt.AccessToken;
const VoiceGrant = AccessToken.VoiceGrant;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const identityRaw = (session as any)?.user?.email || (session as any)?.user?.name || "";
  const identity = String(identityRaw).trim().toLowerCase();
  if (!identity) return res.status(401).json({ error: "Unauthorized" });

  try {
    const {
      TWILIO_ACCOUNT_SID,
      TWILIO_API_KEY_SID,
      TWILIO_API_KEY_SECRET,
      TWILIO_API_KEY,
      TWILIO_API_SECRET,
      TWILIO_TWIML_APP_SID,
      TWILIO_APP_SID,
    } = process.env;

    const apiKeySid = TWILIO_API_KEY_SID || TWILIO_API_KEY || "";
    const apiKeySecret = TWILIO_API_KEY_SECRET || TWILIO_API_SECRET || "";
    const appSid = TWILIO_TWIML_APP_SID || TWILIO_APP_SID || undefined;

    if (!TWILIO_ACCOUNT_SID || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({ error: "Twilio environment variables missing (Account SID, API Key SID/Secret)" });
    }

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: appSid,
      incomingAllow: true,
    });

    const token = new AccessToken(
      TWILIO_ACCOUNT_SID,
      apiKeySid,
      apiKeySecret,
      { identity, ttl: 3600 }
    );

    token.addGrant(voiceGrant);

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ token: token.toJwt(), identity });
  } catch (error: any) {
    console.error("Token generation error:", error);
    return res.status(500).json({ error: "Failed to generate token", detail: String(error?.message || error) });
  }
}

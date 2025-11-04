// /pages/api/twilio/voice/token.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
// Use absolute import so pages router resolves correctly
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

/**
 * Twilio Voice Access Token for the Twilio Voice JS SDK.
 * - MUST use (accountSid, apiKeySid, apiKeySecret) — not the Auth Token
 * - Adds VoiceGrant (incomingAllow + optional outgoingApplicationSid)
 * - identity = authenticated user's email (fallback: name)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const s = session as any; // avoid TS inference to {}
  const identity = (s?.user?.email || s?.user?.name || "").trim();
  if (!identity) return res.status(401).json({ message: "Unauthorized" });

  try {
    // Resolve per-user or platform Twilio credentials
    const resolved = (await getClientForUser(identity)) as any;
    const { accountSid, usingPersonal, user } = resolved || {};

    // API Key pair (NOT auth token)
    const apiKeySid =
      (usingPersonal ? user?.twilioApiKeySid : process.env.TWILIO_API_KEY_SID) || "";
    const apiKeySecret =
      (usingPersonal ? user?.twilioApiKeySecret : process.env.TWILIO_API_KEY_SECRET) || "";

    // Optional TwiML App SID for client -> PSTN dialing
    const outgoingAppSid =
      (usingPersonal ? user?.twimlAppSid : process.env.TWILIO_TWIML_APP_SID) || undefined;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        message: "Twilio Voice is not fully configured",
        detail: {
          accountSidPresent: !!accountSid,
          apiKeySidPresent: !!apiKeySid,
          apiKeySecretPresent: !!apiKeySecret,
          hint: "AccessToken must use API Key SID/Secret (not the Auth Token).",
        },
      });
    }

    const { jwt } = twilio as any;
    const AccessToken = jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600,
    });

    const grant = new VoiceGrant({
      incomingAllow: true,
      outgoingApplicationSid: outgoingAppSid,
    });

    token.addGrant(grant);

    return res.status(200).json({
      token: token.toJwt(),
      identity,
      account: mask(accountSid),
      usingPersonal: !!usingPersonal,
      hasOutgoingApp: !!outgoingAppSid,
    });
  } catch (err: any) {
    console.error("❌ /api/twilio/voice/token error:", err);
    return res.status(500).json({
      message: "Unable to generate token",
      error: String(err?.message || err),
    });
  }
}

function mask(s?: string | null) {
  if (!s) return null;
  const v = String(s);
  return v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v;
}

// /pages/api/twilio/voice/token.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

/**
 * Twilio Voice Access Token (for Twilio Voice JS SDK).
 * - MUST use (accountSid, apiKeySid, apiKeySecret) — not Auth Token
 * - Adds VoiceGrant (incomingAllow + optional outgoingApplicationSid)
 * - identity = authenticated user's email (fallback: name)
 * - If user-specific API keys are missing, falls back to platform envs.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const s = session as any;
  const identity = (s?.user?.email || s?.user?.name || "").trim();
  if (!identity) return res.status(401).json({ message: "Unauthorized" });

  try {
    // Resolve per-user or platform Account SID
    const resolved = (await getClientForUser(identity)) as any;
    const usingPersonal = !!resolved?.usingPersonal;
    const user = resolved?.user || {};
    const accountSid: string =
      (resolved?.accountSid as string) ||
      process.env.TWILIO_ACCOUNT_SID ||
      "";

    // Prefer user keys when present, otherwise fall back to platform envs.
    const envApiKeySid = process.env.TWILIO_API_KEY_SID || "";
    const envApiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";

    const apiKeySid: string =
      (usingPersonal && user?.twilioApiKeySid) ? user.twilioApiKeySid : envApiKeySid;
    const apiKeySecret: string =
      (usingPersonal && user?.twilioApiKeySecret) ? user.twilioApiKeySecret : envApiKeySecret;

    // Optional TwiML App SID for client -> PSTN
    const outgoingAppSid: string | undefined =
      (usingPersonal && user?.twimlAppSid) ? user.twimlAppSid : (process.env.TWILIO_TWIML_APP_SID || undefined);

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        message: "Twilio Voice is not fully configured",
        detail: {
          accountSidPresent: !!accountSid,
          apiKeySidPresent: !!apiKeySid,
          apiKeySecretPresent: !!apiKeySecret,
          hint: "AccessToken must use API Key SID/Secret (not the Auth Token). Ensure envs are set for the current deployment environment.",
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
      keySource: (usingPersonal && user?.twilioApiKeySid && user?.twilioApiKeySecret) ? "user" : "env",
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

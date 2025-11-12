// /pages/api/twilio/voice/token.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const identityRaw = (session as any)?.user?.email || (session as any)?.user?.name || "";
  const identity = String(identityRaw).trim().toLowerCase();
  if (!identity) return res.status(401).json({ message: "Unauthorized" });

  try {
    const resolved = (await getClientForUser(identity)) as any;
    const usingPersonal = !!resolved?.usingPersonal;
    const user = resolved?.user || {};
    const accountSid: string =
      (resolved?.accountSid as string) ||
      process.env.TWILIO_ACCOUNT_SID ||
      "";

    // Prefer per-user API key/secret; fall back to platform envs
    const envKeySid = process.env.TWILIO_API_KEY_SID || process.env.TWILIO_API_KEY || "";
    const envKeySecret = process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_API_SECRET || "";

    const apiKeySid: string =
      (usingPersonal && user?.twilioApiKeySid) ? user.twilioApiKeySid : envKeySid;
    const apiKeySecret: string =
      (usingPersonal && user?.twilioApiKeySecret) ? user.twilioApiKeySecret : envKeySecret;

    // Optional TwiML App SID (either name supported)
    const outgoingAppSid: string | undefined =
      (usingPersonal && user?.twimlAppSid)
        ? user.twimlAppSid
        : (process.env.TWILIO_TWIML_APP_SID || process.env.TWILIO_APP_SID || undefined);

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        message: "Twilio Voice is not fully configured",
        detail: {
          accountSidPresent: !!accountSid,
          apiKeySidPresent: !!apiKeySid,
          apiKeySecretPresent: !!apiKeySecret,
          hint: "Voice AccessTokens must be signed with API Key SID/Secret (not Auth Token).",
        },
      });
    }

    const { jwt } = twilio as any;
    const AccessToken = jwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600, // 1 hour
    });

    const grant = new VoiceGrant({
      incomingAllow: true,
      outgoingApplicationSid: outgoingAppSid,
    });
    token.addGrant(grant);

    res.setHeader("Cache-Control", "no-store");
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

// /pages/api/twilio/voice/token.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
// Use absolute alias to avoid relative resolution pitfalls in pages router:
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

/**
 * Returns a Twilio Voice Access Token suitable for the Twilio Voice JS SDK.
 * Critical rules:
 *  - Construct AccessToken with (accountSid, apiKeySid, apiKeySecret). DO NOT use authToken here.
 *  - Add a VoiceGrant with either incomingAllow or outgoingApplicationSid (TwiML App SID).
 *  - Set a stable identity (we use the authenticated user's email).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const identity = (session?.user?.email || session?.user?.name || "").trim();
  if (!identity) return res.status(401).json({ message: "Unauthorized" });

  try {
    // Resolve which Twilio account + credentials to use (per-user or platform)
    const resolved = await getClientForUser(identity);
    const { accountSid, usingPersonal, user } = resolved || ({} as any);

    // API Key pair (NOT auth token)
    const apiKeySid =
      (usingPersonal ? user?.twilioApiKeySid : process.env.TWILIO_API_KEY_SID) || "";
    const apiKeySecret =
      (usingPersonal ? user?.twilioApiKeySecret : process.env.TWILIO_API_KEY_SECRET) || "";

    // Optional: TwiML App SID if you're using client -> PSTN via <Dial>
    const outgoingAppSid =
      (usingPersonal ? user?.twimlAppSid : process.env.TWILIO_TWIML_APP_SID) || undefined;

    if (!accountSid || !apiKeySid || !apiKeySecret) {
      return res.status(500).json({
        message: "Twilio Voice is not fully configured",
        detail: {
          accountSidPresent: !!accountSid,
          apiKeySidPresent: !!apiKeySid,
          apiKeySecretPresent: !!apiKeySecret,
          hint: "AccessToken must use API Key SID/Secret, not the Auth Token.",
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
      incomingAllow: true, // allow Twilio Client to receive calls
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
    // Bubble up the real reason so we can fix it quickly
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

// /pages/api/twilio/voice/token.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import twilio from "twilio";
import jwt from "jsonwebtoken";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  process.env.JWT_SECRET ||
  "dev-mobile-secret";

/**
 * Try to get identity from a Bearer mobile JWT (used by native app).
 */
function getEmailFromMobileAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const emailRaw = (payload?.email || payload?.sub || "").toString();
    const email = emailRaw.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

function mask(s?: string | null) {
  if (!s) return null;
  const v = String(s);
  return v.length > 8 ? `${v.slice(0, 4)}…${v.slice(-4)}` : v;
}

/**
 * Twilio Voice Access Token (for Twilio Voice JS / RN SDK).
 * - Accepts either:
 *   - Mobile Bearer JWT (Authorization: Bearer <mobile token>)
 *   - OR NextAuth web session cookie (fallback).
 * - identity = user email.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  try {
    // 1) Prefer mobile JWT identity
    let identity = getEmailFromMobileAuth(req);

    // 2) Fallback to web session
    if (!identity) {
      const session = await getServerSession(req, res, authOptions as any);
      const s = session as any;
      identity = (s?.user?.email || "").toString().trim();
    }

    if (!identity) {
      return res.status(401).json({ message: "Unauthorized (missing user email for Twilio identity)" });
    }

    identity = identity.toLowerCase();

    // Resolve per-user or platform Account SID
    const resolved = (await getClientForUser(identity)) as any;
    const usingPersonal = !!resolved?.usingPersonal;
    const user = resolved?.user || {};

    // ✅ HARD GUARD: never allow non-admin users to generate Voice tokens from a personal/main Twilio account.
    // This prevents calls being created under the wrong account and "burning clients".
    const role = String(user?.role || "").toLowerCase();
    const platformAccountSid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();

    if (role && role !== "admin") {
      if (usingPersonal) {
        return res.status(403).json({
          message:
            "Twilio Voice is not enabled for personal accounts. Please contact support to enable your CoveCRM subaccount calling.",
          detail: { identity, usingPersonal: true },
        });
      }
    }

    const accountSid: string =
      (resolved?.accountSid as string) || process.env.TWILIO_ACCOUNT_SID || "";
    

    // ✅ HARD GUARD (continued): block non-admin fallback to platform/main account
    if (role && role !== "admin") {
      if (platformAccountSid && accountSid && platformAccountSid === accountSid) {
        return res.status(403).json({
          message:
            "Twilio Voice token blocked (platform account fallback). This user must be assigned a Twilio subaccount.",
          detail: { identity, usingPersonal: false, accountSidMasked: mask(accountSid) },
        });
      }
    }
// Prefer user keys when present, otherwise fall back to platform envs.
    // ✅ IMPORTANT: for platform subaccounts, we MUST use the subaccount-scoped API key
    // and subaccount TwiML App SID (AP...) or the browser leg will be created under the wrong account.
    const envApiKeySid = process.env.TWILIO_API_KEY_SID || "";
    const envApiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";

    // getClientForUser exposes the exact auth used to create the SDK client
    const resolvedAuth = (resolved?.auth || {}) as any;

    const apiKeySid: string =
      resolvedAuth?.mode === "apiKey" && resolvedAuth?.username
        ? String(resolvedAuth.username)
        : usingPersonal && (user?.twilio?.apiKeySid || user?.twilioApiKeySid)
          ? String(user?.twilio?.apiKeySid || user?.twilioApiKeySid)
          : envApiKeySid;

    const apiKeySecret: string =
      resolvedAuth?.mode === "apiKey" && resolvedAuth?.password
        ? String(resolvedAuth.password)
        : usingPersonal && (user?.twilio?.apiKeySecret || user?.twilioApiKeySecret)
          ? String(user?.twilio?.apiKeySecret || user?.twilioApiKeySecret)
          : envApiKeySecret;

    // Optional TwiML App SID for client -> PSTN (must be in SAME account as accountSid)
    const outgoingAppSid: string | undefined =
      (user?.twimlAppSid as string) ||
      (user?.twilio?.twimlAppSid as string) ||
      process.env.TWILIO_TWIML_APP_SID ||
      undefined;

    // Optional Push Credential SID (required for iOS/Android incoming calls via VoIP push)
    // Source priority: user.twilio.pushCredentialSid -> user.pushCredentialSid -> env
    const pushCredentialSid: string | undefined =
      (user?.twilio?.pushCredentialSid as string) ||
      (user?.pushCredentialSid as string) ||
      process.env.TWILIO_VOICE_PUSH_CREDENTIAL_SID ||
      undefined;


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

    // 🚨 New: fail fast if there is no TwiML App for outbound PSTN
    if (!outgoingAppSid) {
      console.error(
        "[voice/token] No outgoing TwiML App SID configured for user",
        identity,
        {
          accountSidMasked: mask(accountSid),
          usingPersonal,
        },
      );
      return res.status(500).json({
        message:
          "Twilio Voice is missing an outgoing TwiML App SID for this user (TWILIO_TWIML_APP_SID or user.twimlAppSid).",
        detail: {
          accountSidMasked: mask(accountSid),
          usingPersonal,
        },
      });
    }

    console.log("[voice/token] issuing token", {
      identity,
      accountSidMasked: mask(accountSid),
      usingPersonal,
      outgoingAppSidMasked: mask(outgoingAppSid),
      keySource:
        usingPersonal && user?.twilioApiKeySid && user?.twilioApiKeySecret
          ? "user"
          : "env",
    });

    const { jwt: TwilioJwt } = twilio as any;
    const AccessToken = TwilioJwt.AccessToken;
    const VoiceGrant = AccessToken.VoiceGrant;

    const token = new AccessToken(accountSid, apiKeySid, apiKeySecret, {
      identity,
      ttl: 3600,
    });

    const grant = new VoiceGrant({
      incomingAllow: true,
      outgoingApplicationSid: outgoingAppSid,
      pushCredentialSid: pushCredentialSid,
    });
    token.addGrant(grant);

    return res.status(200).json({
      token: token.toJwt(),
      identity,
      account: mask(accountSid),
      usingPersonal: !!usingPersonal,
      hasOutgoingApp: !!outgoingAppSid,
      keySource:
        usingPersonal && user?.twilioApiKeySid && user?.twilioApiKeySecret
          ? "user"
          : "env",
    });
  } catch (err: any) {
    console.error("❌ /api/twilio/voice/token error:", err);
    return res.status(500).json({
      message: "Unable to generate token",
      error: String(err?.message || err),
    });
  }
}

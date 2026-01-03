// lib/twilio/getPlatformClient.ts
import twilio, { Twilio } from "twilio";

/**
 * Centralized Twilio platform auth resolver.
 *
 * Prefers:
 *  1) TWILIO_AUTH_TOKEN (classic)
 *  2) TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET
 *
 * Requires:
 *  - TWILIO_ACCOUNT_SID
 */
export type PlatformTwilioAuth =
  | {
      mode: "authToken";
      accountSid: string;
      authToken: string;
      username: string; // for Basic Auth
      password: string; // for Basic Auth
    }
  | {
      mode: "apiKey";
      accountSid: string;
      apiKeySid: string;
      apiKeySecret: string;
      username: string; // for Basic Auth
      password: string; // for Basic Auth
    };

function sanitizeId(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[^A-Za-z0-9]/g, "").trim();
}

export function getPlatformTwilioAuth(): PlatformTwilioAuth {
  const accountSid = sanitizeId(process.env.TWILIO_ACCOUNT_SID || "");
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const apiKeySid = sanitizeId(process.env.TWILIO_API_KEY_SID || "");
  const apiKeySecret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();

  if (!accountSid.startsWith("AC")) {
    throw new Error("Missing/invalid TWILIO_ACCOUNT_SID env.");
  }

  if (authToken) {
    return {
      mode: "authToken",
      accountSid,
      authToken,
      username: accountSid,
      password: authToken,
    };
  }

  if (apiKeySid.startsWith("SK") && apiKeySecret) {
    return {
      mode: "apiKey",
      accountSid,
      apiKeySid,
      apiKeySecret,
      username: apiKeySid,
      password: apiKeySecret,
    };
  }

  throw new Error(
    "Missing Twilio platform credentials. Provide TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET.",
  );
}

/**
 * Returns a Twilio client authenticated as the PLATFORM account.
 */
export function getPlatformTwilioClient(): Twilio {
  const auth = getPlatformTwilioAuth();
  if (auth.mode === "authToken") {
    return twilio(auth.accountSid, auth.authToken);
  }
  return twilio(auth.apiKeySid, auth.apiKeySecret, { accountSid: auth.accountSid });
}

/**
 * Returns a Twilio client authenticated as the PLATFORM creds but scoped to act on a specific account SID.
 * (Used when you want master creds but scope requests to a subaccount via `accountSid` option.)
 */
export function getPlatformTwilioClientScoped(accountSidToScope: string): Twilio {
  const auth = getPlatformTwilioAuth();
  const scopeSid = sanitizeId(accountSidToScope || "");
  if (!scopeSid.startsWith("AC")) {
    throw new Error("getPlatformTwilioClientScoped: invalid account SID to scope.");
  }

  if (auth.mode === "authToken") {
    return twilio(auth.accountSid, auth.authToken, { accountSid: scopeSid });
  }

  return twilio(auth.apiKeySid, auth.apiKeySecret, { accountSid: scopeSid });
}

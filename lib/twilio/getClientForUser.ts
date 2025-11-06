// /lib/twilio/getClientForUser.ts
import twilio, { Twilio } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export type ResolvedTwilioClient = {
  client: Twilio;
  accountSid: string;
  usingPersonal: boolean;
  user: any;
};

function maskSid(sid?: string): string | null {
  if (!sid) return null;
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

/** Remove any non-alphanumeric (handles U+2028 etc.) and trim. */
function sanitizeId(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[^A-Za-z0-9]/g, "").trim();
}

function isSelfBilledWithPersonalCreds(u: any): boolean {
  const hasPersonal =
    !!(u?.twilio?.accountSid && u?.twilio?.apiKeySid && u?.twilio?.apiKeySecret);
  return u?.billingMode === "self" && hasPersonal;
}

function buildTwilioClient(params: {
  accountSid: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  authTokenFallback?: string;
}): Twilio {
  const { accountSid, apiKeySid, apiKeySecret, authTokenFallback } = params;

  // Prefer classic SID+AUTH when provided (most reliable / least confusing)
  if (authTokenFallback) {
    return twilio(accountSid, authTokenFallback, { accountSid });
  }

  // Else use API key pair (must both be present)
  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid });
  }

  throw new Error("Missing Twilio credentials: need AUTH TOKEN or API Key pair.");
}

export async function getClientForUser(email: string): Promise<ResolvedTwilioClient> {
  await dbConnect();

  const normalizedEmail = (email || "").toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).lean<any>();

  // ---------- PERSONAL (self-billed) ----------
  if (isSelfBilledWithPersonalCreds(user)) {
    const rawAccountSid = user.twilio.accountSid as string;
    const rawApiKeySid = user.twilio.apiKeySid as string | undefined;
    const rawApiKeySecret = user.twilio.apiKeySecret as string | undefined;

    const accountSid = sanitizeId(rawAccountSid);
    const apiKeySid = sanitizeId(rawApiKeySid);
    const apiKeySecret = rawApiKeySecret?.trim();

    if (!accountSid || !accountSid.startsWith("AC")) {
      throw new Error("User personal Twilio accountSid is invalid or missing.");
    }
    if (!apiKeySid || !apiKeySid.startsWith("SK") || !apiKeySecret) {
      throw new Error("User personal Twilio API Key SID/Secret are invalid or missing.");
    }

    const client = buildTwilioClient({
      accountSid,
      apiKeySid,
      apiKeySecret,
    });

    console.log(JSON.stringify({
      msg: "getClientForUser: PERSONAL Twilio (API Key)",
      email: normalizedEmail,
      accountSidMasked: maskSid(accountSid),
      billingMode: user?.billingMode,
    }));

    return { client, accountSid, usingPersonal: true, user };
  }

  // ---------- PLATFORM (our shared account) ----------
  const rawPlatformAccount = process.env.TWILIO_ACCOUNT_SID || "";
  const rawPlatformApiKeySid = process.env.TWILIO_API_KEY_SID || "";
  const rawPlatformApiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";
  const rawAuthToken = process.env.TWILIO_AUTH_TOKEN || "";

  const platformAccountSid = sanitizeId(rawPlatformAccount);
  const platformApiKeySid = sanitizeId(rawPlatformApiKeySid);
  const platformApiKeySecret = rawPlatformApiKeySecret?.trim();
  const platformAuthToken = rawAuthToken?.trim();

  if (!platformAccountSid || !platformAccountSid.startsWith("AC")) {
    throw new Error("Missing or invalid TWILIO_ACCOUNT_SID for platform.");
  }

  // IMPORTANT: Prefer classic SID + AUTH TOKEN (avoids 401s when API Keys aren’t fully configured)
  const client = buildTwilioClient({
    accountSid: platformAccountSid,
    authTokenFallback: platformAuthToken || undefined,
    apiKeySid: platformAuthToken ? undefined : (platformApiKeySid || undefined),
    apiKeySecret: platformAuthToken ? undefined : (platformApiKeySecret || undefined),
  });

  console.log(JSON.stringify({
    msg: "getClientForUser: PLATFORM Twilio",
    email: normalizedEmail,
    accountSidMasked: maskSid(platformAccountSid),
    mode: platformAuthToken ? "SID+AUTH_TOKEN" : "API_KEY_PAIR",
  }));

  return {
    client,
    accountSid: platformAccountSid,
    usingPersonal: false,
    user,
  };
}

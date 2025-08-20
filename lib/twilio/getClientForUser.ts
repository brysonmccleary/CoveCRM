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
  if (sid.length <= 6) return sid;
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

  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid });
  }
  if (!authTokenFallback) {
    throw new Error("Missing Twilio auth credentials: no API key pair and no AUTH TOKEN fallback.");
  }
  return twilio(accountSid, authTokenFallback, { accountSid });
}

export async function getClientForUser(email: string): Promise<ResolvedTwilioClient> {
  await dbConnect();

  const normalizedEmail = (email || "").toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).lean<any>();

  const usingPersonal = isSelfBilledWithPersonalCreds(user);

  if (usingPersonal) {
    const rawAccountSid = user.twilio.accountSid as string;
    const rawApiKeySid = user.twilio.apiKeySid as string | undefined;
    const rawApiKeySecret = user.twilio.apiKeySecret as string | undefined;

    const accountSid = sanitizeId(rawAccountSid);
    const apiKeySid = sanitizeId(rawApiKeySid);
    const apiKeySecret = rawApiKeySecret?.trim(); // secrets can have symbols; just trim whitespace

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
      msg: "getClientForUser: using PERSONAL Twilio",
      email: normalizedEmail,
      accountSidMasked: maskSid(accountSid),
      billingMode: user?.billingMode,
    }));

    return { client, accountSid, usingPersonal: true, user };
  }

  // PLATFORM PATH
  const rawPlatformAccount = process.env.TWILIO_ACCOUNT_SID || "";
  const rawPlatformApiKeySid = process.env.TWILIO_API_KEY_SID || "";
  const rawPlatformApiKeySecret = process.env.TWILIO_API_KEY_SECRET || "";
  const rawAuthToken = process.env.TWILIO_AUTH_TOKEN || "";

  const platformAccountSid = sanitizeId(rawPlatformAccount);
  const platformApiKeySid = sanitizeId(rawPlatformApiKeySid);
  const platformApiKeySecret = rawPlatformApiKeySecret?.trim();
  const platformAuthToken = rawAuthToken?.trim();

  if (!platformAccountSid) {
    throw new Error("Missing TWILIO_ACCOUNT_SID for platform.");
  }

  const client = buildTwilioClient({
    accountSid: platformAccountSid,
    apiKeySid: platformApiKeySid || undefined,
    apiKeySecret: platformApiKeySecret || undefined,
    authTokenFallback: platformAuthToken || undefined,
  });

  console.log(JSON.stringify({
    msg: "getClientForUser: using PLATFORM Twilio",
    email: normalizedEmail,
    accountSidMasked: maskSid(platformAccountSid),
    userBillingMode: user?.billingMode ?? null,
  }));

  return {
    client,
    accountSid: platformAccountSid,
    usingPersonal: false,
    user,
  };
}

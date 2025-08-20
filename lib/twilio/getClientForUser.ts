// /lib/twilio/getClientForUser.ts
import twilio, { Twilio } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

/**
 * Result shape for resolved Twilio client.
 */
export type ResolvedTwilioClient = {
  client: Twilio;
  accountSid: string;         // the account we are operating under
  usingPersonal: boolean;     // true if user's personal/self-billed creds are used
  user: any;                  // fresh user doc (lean)
};

/**
 * Decide if the given user should be routed to their personal Twilio.
 * - billingMode must be "self"
 * - and user must have a complete set of Twilio creds
 */
function isSelfBilledWithPersonalCreds(u: any): boolean {
  const hasPersonal =
    !!(u?.twilio?.accountSid && u?.twilio?.apiKeySid && u?.twilio?.apiKeySecret);
  return u?.billingMode === "self" && hasPersonal;
}

/**
 * Build a Twilio client given any of:
 * - API Key SID/Secret + accountSid  (preferred)
 * - Account SID + Auth Token         (fallback for platform)
 *
 * Note: Twilio constructor signature is (username, password, { accountSid }).
 * When using API Keys, username=SK..., password=secret, opts.accountSid=AC...
 * When using Auth Token, username=AC..., password=AUTH_TOKEN, opts.accountSid=AC...
 */
function buildTwilioClient(params: {
  accountSid: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  authTokenFallback?: string;
}): Twilio {
  const { accountSid, apiKeySid, apiKeySecret, authTokenFallback } = params;

  // Prefer API Key auth when present
  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid });
  }

  if (!authTokenFallback) {
    throw new Error(
      "Missing Twilio auth credentials: no API key pair and no AUTH TOKEN fallback."
    );
  }

  // Fallback to Account SID + Auth Token
  return twilio(accountSid, authTokenFallback, { accountSid });
}

/**
 * Resolve the proper Twilio client for a given user email.
 * - If user is self-billed with stored creds => use personal account (usingPersonal=true)
 * - Else => use platform account (usingPersonal=false)
 */
export async function getClientForUser(email: string): Promise<ResolvedTwilioClient> {
  await dbConnect();

  const normalizedEmail = (email || "").toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).lean<any>();

  const usingPersonal = isSelfBilledWithPersonalCreds(user);

  if (usingPersonal) {
    const accountSid = user.twilio.accountSid as string;
    const apiKeySid = user.twilio.apiKeySid as string | undefined;
    const apiKeySecret = user.twilio.apiKeySecret as string | undefined;

    if (!accountSid) {
      throw new Error("User personal Twilio accountSid is missing.");
    }

    // Build client with user API key (required by your debug setter)
    const client = buildTwilioClient({
      accountSid,
      apiKeySid,
      apiKeySecret,
    });

    // Minimal, structured debug to confirm path (visible in Vercel logs)
    console.log(
      JSON.stringify({
        msg: "getClientForUser: using PERSONAL Twilio",
        email: normalizedEmail,
        accountSidMasked: maskSid(accountSid),
        billingMode: user?.billingMode,
      })
    );

    return { client, accountSid, usingPersonal: true, user };
  }

  // PLATFORM PATH
  const platformAccountSid =
    process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_API_KEY_SID || "";
  const platformAuthToken = process.env.TWILIO_AUTH_TOKEN || "";
  const platformApiKeySid = process.env.TWILIO_API_KEY_SID || undefined;
  const platformApiKeySecret = process.env.TWILIO_API_KEY_SECRET || undefined;

  // We require a real Account SID for opts.accountSid
  const platformAccountForOpts = process.env.TWILIO_ACCOUNT_SID || "";
  if (!platformAccountForOpts) {
    throw new Error("Missing TWILIO_ACCOUNT_SID for platform.");
  }

  // Build client preferring API Key pair when available, otherwise AC+AUTH_TOKEN
  const client = buildTwilioClient({
    accountSid: platformAccountForOpts,
    apiKeySid: platformApiKeySid,
    apiKeySecret: platformApiKeySecret,
    authTokenFallback: platformAuthToken || undefined,
  });

  console.log(
    JSON.stringify({
      msg: "getClientForUser: using PLATFORM Twilio",
      email: normalizedEmail,
      accountSidMasked: maskSid(platformAccountForOpts),
      userBillingMode: user?.billingMode ?? null,
      reason:
        user
          ? "billingMode not self or creds incomplete"
          : "no user found; default to platform",
    })
  );

  return {
    client,
    accountSid: platformAccountForOpts,
    usingPersonal: false,
    user,
  };
}

/** Utility to mask SIDs in logs (ACxxxx... or MGxxxx... etc.) */
function maskSid(sid?: string): string | null {
  if (!sid) return null;
  if (sid.length <= 6) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

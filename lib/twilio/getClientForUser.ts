// /lib/twilio/getClientForUser.ts
import twilio, { Twilio } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export type TwilioResolvedAuth = {
  // "authToken" = SID + Auth Token
  // "apiKey" = API Key Sid + Secret
  mode: "authToken" | "apiKey";
  username: string; // Basic auth username
  password: string; // Basic auth password
  // The account SID that requests should be scoped to (tenant account)
  effectiveAccountSid: string;
};

export type ResolvedTwilioClient = {
  client: Twilio;
  accountSid: string;
  usingPersonal: boolean; // same meaning as before
  user: any;

  // ✅ NEW (additive): exposes the exact auth mode + credentials used to build the client,
  // so API routes can make direct TrustHub calls (fetch) without accidentally using
  // the wrong host or wrong scope.
  auth: TwilioResolvedAuth;
};

function maskSid(sid?: string): string | null {
  if (!sid) return null;
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

function sanitizeId(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[^A-Za-z0-9]/g, "").trim();
}

function hasPersonalCreds(u: any): boolean {
  return Boolean(
    u?.twilio?.accountSid &&
      u?.twilio?.apiKeySid &&
      u?.twilio?.apiKeySecret &&
      u?.billingMode === "self",
  );
}

function hasSubaccountCreds(u: any): boolean {
  // subaccount mode = credentials exist but billingMode is NOT "self"
  return Boolean(
    u?.twilio?.accountSid &&
      u?.twilio?.apiKeySid &&
      u?.twilio?.apiKeySecret &&
      u?.billingMode !== "self",
  );
}

// New: user has a subaccount SID but no API keys; billed via platform
function hasSubaccountSidOnly(u: any): boolean {
  const t = u?.twilio || {};
  return Boolean(
    t?.accountSid &&
      u?.billingMode !== "self" &&
      (!t?.apiKeySid || !t?.apiKeySecret),
  );
}

function buildTwilioClient(params: {
  accountSid: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  authToken?: string;
}): Twilio {
  const { accountSid, apiKeySid, apiKeySecret, authToken } = params;

  // Prefer classic SID+AUTH when provided
  if (authToken) return twilio(accountSid, authToken, { accountSid });

  // Else use API key pair (scoped to provided accountSid)
  if (apiKeySid && apiKeySecret)
    return twilio(apiKeySid, apiKeySecret, { accountSid });

  throw new Error("Missing Twilio credentials: need AUTH TOKEN or API Key pair.");
}

export async function getClientForUser(
  email: string,
): Promise<ResolvedTwilioClient> {
  await dbConnect();

  const normalizedEmail = (email || "").toLowerCase().trim();
  if (!normalizedEmail) {
    throw new Error("getClientForUser: missing email");
  }

  const user = await User.findOne({ email: normalizedEmail }).lean<any>();

  // ✅ CRITICAL: never silently fall back to platform when we can't resolve a tenant user.
  // If this triggers, your session/email mapping is broken and MUST be fixed.
  if (!user) {
    throw new Error(
      `getClientForUser: User not found for email: ${normalizedEmail}`,
    );
  }

  const FORCE_PLATFORM = (process.env.TWILIO_FORCE_PLATFORM || "") === "1";

  // Platform credentials (master account)
  const platformAccountSid = sanitizeId(process.env.TWILIO_ACCOUNT_SID || "");
  const platformAuthToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const platformApiKeySid = sanitizeId(process.env.TWILIO_API_KEY_SID || "");
  const platformApiKeySecret = String(
    process.env.TWILIO_API_KEY_SECRET || "",
  ).trim();

  // ---------- PERSONAL (self-billed) ----------
  const personalEligible = !FORCE_PLATFORM && hasPersonalCreds(user);
  if (personalEligible) {
    const accountSid = sanitizeId(user.twilio.accountSid);
    const apiKeySid = sanitizeId(user.twilio.apiKeySid);
    const apiKeySecret = String(user.twilio.apiKeySecret || "").trim();

    if (!accountSid.startsWith("AC"))
      throw new Error("User personal accountSid invalid.");

    // SPECIAL CASE: platform owner using their main Twilio as "personal"
    // If this user's accountSid == platformAccountSid and we have a platform AUTH TOKEN,
    // prefer SID+AUTH only if it actually works; else fall back to their API key pair.
    const isPlatformOwner =
      platformAccountSid &&
      platformAccountSid === accountSid &&
      !!platformAuthToken;

    let client: Twilio;
    let auth: TwilioResolvedAuth;

    if (isPlatformOwner) {
      const testClient = buildTwilioClient({
        accountSid,
        authToken: platformAuthToken,
      });

      try {
        await testClient.api.v2010.accounts(accountSid).fetch();
        client = testClient;

        auth = {
          mode: "authToken",
          username: accountSid,
          password: platformAuthToken,
          effectiveAccountSid: accountSid,
        };

        console.log(
          JSON.stringify({
            msg: "getClientForUser: PERSONAL Twilio (platform auth token)",
            email: normalizedEmail,
            accountSidMasked: maskSid(accountSid),
            billingMode: user?.billingMode,
          }),
        );
      } catch (e: any) {
        // Fall back to user API keys if platform token is misconfigured
        if (!apiKeySid.startsWith("SK") || !apiKeySecret) {
          throw new Error(
            "User personal API key invalid (and platform auth token failed).",
          );
        }

        client = buildTwilioClient({ accountSid, apiKeySid, apiKeySecret });

        auth = {
          mode: "apiKey",
          username: apiKeySid,
          password: apiKeySecret,
          effectiveAccountSid: accountSid,
        };

        console.log(
          JSON.stringify({
            msg: "getClientForUser: PERSONAL Twilio (API Key fallback; platform token failed)",
            email: normalizedEmail,
            accountSidMasked: maskSid(accountSid),
            billingMode: user?.billingMode,
            platformTokenError: e?.message || String(e),
          }),
        );
      }
    } else {
      if (!apiKeySid.startsWith("SK") || !apiKeySecret) {
        throw new Error("User personal API key invalid.");
      }

      client = buildTwilioClient({ accountSid, apiKeySid, apiKeySecret });

      auth = {
        mode: "apiKey",
        username: apiKeySid,
        password: apiKeySecret,
        effectiveAccountSid: accountSid,
      };

      console.log(
        JSON.stringify({
          msg: "getClientForUser: PERSONAL Twilio (API Key)",
          email: normalizedEmail,
          accountSidMasked: maskSid(accountSid),
          billingMode: user?.billingMode,
        }),
      );
    }

    return { client, accountSid, usingPersonal: true, user, auth };
  }

  // ---------- SUBACCOUNT (platform-billed per user, with their own API keys) ----------
  if (!FORCE_PLATFORM && hasSubaccountCreds(user)) {
    const subSid = sanitizeId(user.twilio.accountSid);
    const apiKeySid = sanitizeId(user.twilio.apiKeySid);
    const apiKeySecret = String(user.twilio.apiKeySecret || "").trim();

    if (!subSid.startsWith("AC")) throw new Error("User subaccountSid invalid.");
    if (!apiKeySid.startsWith("SK") || !apiKeySecret)
      throw new Error("User subaccount API key invalid.");

    const client = buildTwilioClient({
      accountSid: subSid,
      apiKeySid,
      apiKeySecret,
    });

    const auth: TwilioResolvedAuth = {
      mode: "apiKey",
      username: apiKeySid,
      password: apiKeySecret,
      effectiveAccountSid: subSid,
    };

    console.log(
      JSON.stringify({
        msg: "getClientForUser: SUBACCOUNT Twilio (API Key)",
        email: normalizedEmail,
        subSidMasked: maskSid(subSid),
        parentMasked: maskSid(platformAccountSid),
        billingMode: user?.billingMode || "platform",
      }),
    );

    // NOTE: usingPersonal=false here (still platform-billed, just isolated)
    return { client, accountSid: subSid, usingPersonal: false, user, auth };
  }

  // ---------- SUBACCOUNT via PLATFORM CREDS (SID only on user) ----------
  // This is your current setup: user.twilio.accountSid exists, but no API keys.
  if (!FORCE_PLATFORM && hasSubaccountSidOnly(user)) {
    const subSid = sanitizeId(user.twilio.accountSid);
    if (!subSid.startsWith("AC")) throw new Error("User subaccountSid invalid.");
    if (!platformAccountSid.startsWith("AC")) {
      throw new Error("Missing/invalid TWILIO_ACCOUNT_SID for platform.");
    }

    let client: Twilio;
    let auth: TwilioResolvedAuth;

    if (platformAuthToken) {
      // Use master SID + Auth Token, but scope requests to the subaccount
      client = twilio(platformAccountSid, platformAuthToken, {
        accountSid: subSid,
      });

      auth = {
        mode: "authToken",
        username: platformAccountSid,
        password: platformAuthToken,
        effectiveAccountSid: subSid,
      };
    } else if (platformApiKeySid && platformApiKeySecret) {
      // Or master API key pair, scoped to the subaccount
      client = twilio(platformApiKeySid, platformApiKeySecret, {
        accountSid: subSid,
      });

      auth = {
        mode: "apiKey",
        username: platformApiKeySid,
        password: platformApiKeySecret,
        effectiveAccountSid: subSid,
      };
    } else {
      throw new Error("Missing platform Twilio credentials for subaccount.");
    }

    console.log(
      JSON.stringify({
        msg: "getClientForUser: SUBACCOUNT Twilio (platform creds)",
        email: normalizedEmail,
        subSidMasked: maskSid(subSid),
        parentMasked: maskSid(platformAccountSid),
        billingMode: user?.billingMode || "platform",
      }),
    );

    return { client, accountSid: subSid, usingPersonal: false, user, auth };
  }

  // ---------- PLATFORM (shared master account) ----------
  if (!platformAccountSid.startsWith("AC")) {
    throw new Error("Missing/invalid TWILIO_ACCOUNT_SID for platform.");
  }

  const client = buildTwilioClient({
    accountSid: platformAccountSid,
    authToken: platformAuthToken || undefined,
    apiKeySid: platformAuthToken ? undefined : platformApiKeySid || undefined,
    apiKeySecret: platformAuthToken
      ? undefined
      : platformApiKeySecret || undefined,
  });

  const auth: TwilioResolvedAuth = platformAuthToken
    ? {
        mode: "authToken",
        username: platformAccountSid,
        password: platformAuthToken,
        effectiveAccountSid: platformAccountSid,
      }
    : {
        mode: "apiKey",
        username: platformApiKeySid,
        password: platformApiKeySecret,
        effectiveAccountSid: platformAccountSid,
      };

  console.log(
    JSON.stringify({
      msg: "getClientForUser: PLATFORM Twilio",
      email: normalizedEmail,
      accountSidMasked: maskSid(platformAccountSid),
      mode: platformAuthToken ? "SID+AUTH_TOKEN" : "API_KEY_PAIR",
      forcePlatform: FORCE_PLATFORM,
      userBillingMode: user?.billingMode ?? null,
    }),
  );

  return { client, accountSid: platformAccountSid, usingPersonal: false, user, auth };
}

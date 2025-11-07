// /lib/twilio/getClientForUser.ts
import twilio, { Twilio } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export type ResolvedTwilioClient = {
  client: Twilio;
  accountSid: string;
  usingPersonal: boolean; // same meaning as before
  user: any;
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
  return Boolean(u?.twilio?.accountSid && u?.twilio?.apiKeySid && u?.twilio?.apiKeySecret && u?.billingMode === "self");
}

function hasSubaccountCreds(u: any): boolean {
  // subaccount mode = credentials exist but billingMode is NOT "self"
  return Boolean(u?.twilio?.accountSid && u?.twilio?.apiKeySid && u?.twilio?.apiKeySecret && u?.billingMode !== "self");
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
  if (apiKeySid && apiKeySecret) return twilio(apiKeySid, apiKeySecret, { accountSid });

  throw new Error("Missing Twilio credentials: need AUTH TOKEN or API Key pair.");
}

export async function getClientForUser(email: string): Promise<ResolvedTwilioClient> {
  await dbConnect();

  const normalizedEmail = (email || "").toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail }).lean<any>();

  const FORCE_PLATFORM = (process.env.TWILIO_FORCE_PLATFORM || "") === "1";

  // ---------- PERSONAL (self-billed) ----------
  const personalEligible = !FORCE_PLATFORM && hasPersonalCreds(user);
  if (personalEligible) {
    const accountSid = sanitizeId(user.twilio.accountSid);
    const apiKeySid = sanitizeId(user.twilio.apiKeySid);
    const apiKeySecret = String(user.twilio.apiKeySecret || "").trim();

    if (!accountSid.startsWith("AC")) throw new Error("User personal accountSid invalid.");
    if (!apiKeySid.startsWith("SK") || !apiKeySecret) throw new Error("User personal API key invalid.");

    const client = buildTwilioClient({ accountSid, apiKeySid, apiKeySecret });

    console.log(JSON.stringify({
      msg: "getClientForUser: PERSONAL Twilio (API Key)",
      email: normalizedEmail,
      accountSidMasked: maskSid(accountSid),
      billingMode: user?.billingMode,
    }));

    return { client, accountSid, usingPersonal: true, user };
  }

  // ---------- SUBACCOUNT (platform-billed per user) ----------
  // Created by our provisioner; still billed to the master but isolated per user.
  const platformAccountSid = sanitizeId(process.env.TWILIO_ACCOUNT_SID || "");
  if (!FORCE_PLATFORM && hasSubaccountCreds(user)) {
    const subSid = sanitizeId(user.twilio.accountSid);
    const apiKeySid = sanitizeId(user.twilio.apiKeySid);
    const apiKeySecret = String(user.twilio.apiKeySecret || "").trim();

    if (!subSid.startsWith("AC")) throw new Error("User subaccountSid invalid.");
    if (!apiKeySid.startsWith("SK") || !apiKeySecret) throw new Error("User subaccount API key invalid.");

    const client = buildTwilioClient({ accountSid: subSid, apiKeySid, apiKeySecret });

    console.log(JSON.stringify({
      msg: "getClientForUser: SUBACCOUNT Twilio (API Key)",
      email: normalizedEmail,
      subSidMasked: maskSid(subSid),
      parentMasked: maskSid(platformAccountSid),
      billingMode: user?.billingMode || "platform",
    }));

    // NOTE: usingPersonal=false here (still platform-billed, just isolated)
    return { client, accountSid: subSid, usingPersonal: false, user };
  }

  // ---------- PLATFORM (shared master account) ----------
  const platformAuthToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const platformApiKeySid = sanitizeId(process.env.TWILIO_API_KEY_SID || "");
  const platformApiKeySecret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();

  if (!platformAccountSid.startsWith("AC")) {
    throw new Error("Missing/invalid TWILIO_ACCOUNT_SID for platform.");
  }

  const client = buildTwilioClient({
    accountSid: platformAccountSid,
    authToken: platformAuthToken || undefined,
    apiKeySid: platformAuthToken ? undefined : (platformApiKeySid || undefined),
    apiKeySecret: platformAuthToken ? undefined : (platformApiKeySecret || undefined),
  });

  console.log(JSON.stringify({
    msg: "getClientForUser: PLATFORM Twilio",
    email: normalizedEmail,
    accountSidMasked: maskSid(platformAccountSid),
    mode: platformAuthToken ? "SID+AUTH_TOKEN" : "API_KEY_PAIR",
    forcePlatform: FORCE_PLATFORM,
    userBillingMode: user?.billingMode ?? null,
  }));

  return { client, accountSid: platformAccountSid, usingPersonal: false, user };
}

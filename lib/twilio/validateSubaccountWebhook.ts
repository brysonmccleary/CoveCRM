import twilio from "twilio";
import {
  getPlatformTwilioAuth,
  getPlatformTwilioClient,
} from "@/lib/twilio/getPlatformClient";

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedToken = { token: string; expiresAt: number };

declare global {
  // eslint-disable-next-line no-var
  var __twilioSubaccountWebhookTokens: Map<string, CachedToken> | undefined;
}

const tokenCache =
  global.__twilioSubaccountWebhookTokens || new Map<string, CachedToken>();
if (!global.__twilioSubaccountWebhookTokens) {
  global.__twilioSubaccountWebhookTokens = tokenCache;
}

function cleanAccountSid(value: unknown) {
  const sid = String(value || "").replace(/[^A-Za-z0-9]/g, "").trim();
  return /^AC[a-zA-Z0-9]{32}$/.test(sid) ? sid : "";
}

export async function getWebhookAuthTokenForAccount(accountSidRaw: unknown) {
  const accountSid = cleanAccountSid(accountSidRaw);
  if (!accountSid) throw new Error("Twilio callback is missing a valid AccountSid");

  const cached = tokenCache.get(accountSid);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const platform = getPlatformTwilioAuth();
  let token = "";

  if (accountSid === platform.accountSid) {
    if (platform.mode !== "authToken") {
      throw new Error("Platform Auth Token is required for platform-account webhook validation");
    }
    token = platform.authToken;
  } else {
    const account = await getPlatformTwilioClient()
      .api.v2010.accounts(accountSid)
      .fetch();
    const ownerAccountSid = cleanAccountSid((account as any)?.ownerAccountSid);
    if (ownerAccountSid && ownerAccountSid !== platform.accountSid) {
      throw new Error("Twilio callback AccountSid is not owned by the platform account");
    }
    token = String((account as any)?.authToken || "").trim();
  }

  if (!token) throw new Error("Twilio did not return a webhook Auth Token for AccountSid");
  tokenCache.set(accountSid, { token, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return token;
}

export async function validateSubaccountWebhook(args: {
  accountSid: unknown;
  signature: string;
  urls: string[];
  params: Record<string, string>;
}) {
  if (!args.signature || args.urls.length === 0) return false;
  const token = await getWebhookAuthTokenForAccount(args.accountSid);
  return args.urls.some((url) =>
    twilio.validateRequest(token, args.signature, url, args.params),
  );
}

export function clearWebhookTokenCacheForTests() {
  tokenCache.clear();
}

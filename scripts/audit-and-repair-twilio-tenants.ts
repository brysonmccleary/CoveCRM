import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local", override: false });
dotenvConfig({ path: ".env", override: false });

import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { Buffer } from "buffer";

const REPAIR = process.env.REPAIR === "1";
const ONLY_EMAIL = String(process.env.EMAIL || "").toLowerCase().trim();
const VOICE_URL = "https://www.covecrm.com/api/voice/agent-join";

function sanitizeId(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[^A-Za-z0-9]/g, "").trim();
}

function maskSid(sid?: string | null): string | null {
  if (!sid) return null;
  if (sid.length <= 8) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

function normalizeE164(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\+\d{10,15}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

function basicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

function getTwilioErrorCode(e: any): string {
  return String(e?.code || e?.status || e?.statusCode || "").trim();
}

function isTwilioAuthError(e: any): boolean {
  const code = getTwilioErrorCode(e);
  const message = String(e?.message || e || "").toLowerCase();
  return code === "401" || code === "20003" || message.includes("authenticate");
}

function isTwilioNotFoundError(e: any): boolean {
  const code = getTwilioErrorCode(e);
  const message = String(e?.message || e || "").toLowerCase();
  return code === "404" || code === "20404" || message.includes("not found");
}

function getPlatformAuth(): { username: string; password: string; accountSid: string } {
  const accountSid = sanitizeId(process.env.TWILIO_ACCOUNT_SID || "");
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  const apiKeySid = sanitizeId(process.env.TWILIO_API_KEY_SID || "");
  const apiKeySecret = String(process.env.TWILIO_API_KEY_SECRET || "").trim();

  if (!accountSid.startsWith("AC")) throw new Error("Missing TWILIO_ACCOUNT_SID.");
  if (authToken) return { username: accountSid, password: authToken, accountSid };
  if (apiKeySid && apiKeySecret) return { username: apiKeySid, password: apiKeySecret, accountSid };
  throw new Error("Missing platform Twilio auth.");
}

async function createSubaccountApiKeyRaw(args: {
  subSid: string;
  friendlyName: string;
  platformAuth: { username: string; password: string };
}): Promise<{ apiKeySid: string; apiKeySecret: string }> {
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(args.subSid)}/Keys.json`;
  const body = new URLSearchParams();
  body.set("FriendlyName", args.friendlyName);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(args.platformAuth.username, args.platformAuth.password),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await resp.text();
  const data = text ? JSON.parse(text) : {};
  if (!resp.ok) {
    throw new Error(`Keys.create failed status=${resp.status} code=${data?.code || "?"} message=${data?.message || text}`);
  }

  const apiKeySid = sanitizeId(data?.sid || "");
  const apiKeySecret = String(data?.secret || "").trim();
  if (!apiKeySid.startsWith("SK") || !apiKeySecret) {
    throw new Error("Keys.create succeeded but returned no API key secret.");
  }

  return { apiKeySid, apiKeySecret };
}

async function validateApiKey(subSid: string, apiKeySid: string, apiKeySecret: string) {
  const client = twilio(apiKeySid, apiKeySecret, { accountSid: subSid });
  await (client as any).applications.list({ limit: 1 });
}

async function ensureTwimlApp(args: {
  user: any;
  subSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  repair: boolean;
}): Promise<{ ok: boolean; sid?: string; action: "validated" | "reused" | "created" | "missing" | "failed"; error?: string }> {
  const client = twilio(args.apiKeySid, args.apiKeySecret, { accountSid: args.subSid });
  const existing = sanitizeId(args.user?.twilio?.twimlAppSid || args.user?.twimlAppSid || "");
  const friendlyName = `CoveCRM Browser - ${args.user.email}`;

  if (existing.startsWith("AP")) {
    try {
      const app = await (client as any).applications(existing).fetch();
      if (String(app?.voiceUrl || "") !== VOICE_URL || String(app?.voiceMethod || "").toUpperCase() !== "POST") {
        if (!args.repair) return { ok: false, sid: existing, action: "failed", error: "TwiML App URL/method mismatch" };
        await (client as any).applications(existing).update({ voiceUrl: VOICE_URL, voiceMethod: "POST" });
      }
      return { ok: true, sid: existing, action: "validated" };
    } catch (e: any) {
      if (isTwilioAuthError(e)) throw e;
      if (!isTwilioNotFoundError(e)) return { ok: false, sid: existing, action: "failed", error: e?.message || String(e) };
    }
  }

  let reusable: any = null;
  try {
    const apps = await (client as any).applications.list({ friendlyName, limit: 20 });
    reusable = Array.isArray(apps)
      ? apps.find((candidate: any) => String(candidate?.sid || "").startsWith("AP"))
      : null;
  } catch (e: any) {
    return { ok: false, action: "failed", error: e?.message || String(e) };
  }

  if (reusable?.sid) {
    if (!args.repair) return { ok: false, sid: reusable.sid, action: "reused", error: "Stored TwiML App stale; matching app exists" };
    await (client as any).applications(String(reusable.sid)).update({ voiceUrl: VOICE_URL, voiceMethod: "POST" });
    await User.updateOne(
      { _id: args.user._id },
      { $set: { "twilio.twimlAppSid": String(reusable.sid), twimlAppSid: String(reusable.sid) } },
    );
    return { ok: true, sid: String(reusable.sid), action: "reused" };
  }

  if (!args.repair) return { ok: false, action: "missing", error: "No TwiML App exists inside stored accountSid" };

  const app = await (client as any).applications.create({
    friendlyName,
    voiceUrl: VOICE_URL,
    voiceMethod: "POST",
  });
  const sid = sanitizeId(app?.sid || "");
  if (!sid.startsWith("AP")) return { ok: false, action: "failed", error: "TwiML App create returned no AP SID" };

  await User.updateOne(
    { _id: args.user._id },
    { $set: { "twilio.twimlAppSid": sid, twimlAppSid: sid } },
  );

  return { ok: true, sid, action: "created" };
}

function pickStoredNumbers(user: any): string[] {
  const numbers = Array.isArray(user?.numbers) ? user.numbers : [];
  const values = new Set<string>();

  for (const entry of numbers) {
    const phone = normalizeE164(entry?.phoneNumber);
    if (phone) values.add(phone);
  }

  const defaultSmsNumberId = String(user?.defaultSmsNumberId || "");
  if (defaultSmsNumberId) {
    const owned = numbers.find((entry: any) => {
      const entryId = entry?._id ? String(entry._id) : "";
      return entryId === defaultSmsNumberId || String(entry?.sid || "") === defaultSmsNumberId;
    });
    const phone = normalizeE164(owned?.phoneNumber);
    if (phone) values.add(phone);
  }

  return [...values];
}

async function verifyNumbers(user: any, subClient: any): Promise<{ ok: boolean; details: string[] }> {
  const phones = pickStoredNumbers(user);
  if (!phones.length) return { ok: true, details: ["no stored user.numbers to verify"] };

  const details: string[] = [];
  let ok = true;
  for (const phone of phones) {
    try {
      const found = await subClient.incomingPhoneNumbers.list({ phoneNumber: phone, limit: 1 });
      if (found.length) {
        details.push(`${phone}:found`);
      } else {
        ok = false;
        details.push(`${phone}:missing`);
      }
    } catch (e: any) {
      ok = false;
      details.push(`${phone}:error:${e?.message || e}`);
    }
  }
  return { ok, details };
}

async function run() {
  await dbConnect();
  const platformAuth = getPlatformAuth();
  const query: any = {
    billingMode: { $ne: "self" },
    "twilio.accountSid": /^AC/,
  };
  if (ONLY_EMAIL) query.email = ONLY_EMAIL;

  const users = await User.find(query).lean<any>();
  console.log(`Twilio tenant audit mode=${REPAIR ? "REPAIR" : "READ_ONLY"} users=${users.length}`);

  for (const user of users) {
    const email = String(user.email || "").toLowerCase();
    const subSid = sanitizeId(user?.twilio?.accountSid || "");
    const apiKeySid = sanitizeId(user?.twilio?.apiKeySid || "");
    const apiKeySecret = String(user?.twilio?.apiKeySecret || "").trim();
    const subClient = twilio(platformAuth.username, platformAuth.password, { accountSid: subSid });

    let apiOk = false;
    let apiAction = "validated";
    let workingKeySid = apiKeySid;
    let workingKeySecret = apiKeySecret;
    let apiError = "";

    if (apiKeySid.startsWith("SK") && apiKeySecret) {
      try {
        await validateApiKey(subSid, apiKeySid, apiKeySecret);
        apiOk = true;
      } catch (e: any) {
        apiError = e?.message || String(e);
        if (!isTwilioAuthError(e)) {
          apiAction = "failed";
        } else if (REPAIR) {
          const rotated = await createSubaccountApiKeyRaw({
            subSid,
            friendlyName: `CoveCRM Subaccount Key - ${email}`,
            platformAuth,
          });
          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                "twilio.accountSid": subSid,
                "twilio.apiKeySid": rotated.apiKeySid,
                "twilio.apiKeySecret": rotated.apiKeySecret,
              },
            },
          );
          workingKeySid = rotated.apiKeySid;
          workingKeySecret = rotated.apiKeySecret;
          await validateApiKey(subSid, workingKeySid, workingKeySecret);
          apiOk = true;
          apiAction = "rotated";
          apiError = "";
        } else {
          apiAction = "auth_failed";
        }
      }
    } else if (REPAIR) {
      const rotated = await createSubaccountApiKeyRaw({
        subSid,
        friendlyName: `CoveCRM Subaccount Key - ${email}`,
        platformAuth,
      });
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            "twilio.accountSid": subSid,
            "twilio.apiKeySid": rotated.apiKeySid,
            "twilio.apiKeySecret": rotated.apiKeySecret,
          },
        },
      );
      workingKeySid = rotated.apiKeySid;
      workingKeySecret = rotated.apiKeySecret;
      apiOk = true;
      apiAction = "created";
    } else {
      apiAction = "missing";
      apiError = "missing apiKeySid/apiKeySecret";
    }

    const numberCheck = await verifyNumbers(user, subClient);
    let appResult: Awaited<ReturnType<typeof ensureTwimlApp>> = {
      ok: false,
      action: "failed",
      error: "API key unavailable",
    };

    if (workingKeySid.startsWith("SK") && workingKeySecret) {
      appResult = await ensureTwimlApp({
        user,
        subSid,
        apiKeySid: workingKeySid,
        apiKeySecret: workingKeySecret,
        repair: REPAIR,
      });
    }

    const pass = apiOk && numberCheck.ok && appResult.ok;
    console.log(JSON.stringify({
      status: pass ? "PASS" : "FAIL",
      email,
      subSidMasked: maskSid(subSid),
      apiKeySidMasked: maskSid(workingKeySid || apiKeySid),
      api: { ok: apiOk, action: apiAction, error: apiError || undefined },
      numbers: numberCheck,
      twimlApp: {
        ok: appResult.ok,
        action: appResult.action,
        twimlAppSidMasked: maskSid(appResult.sid),
        error: appResult.error,
      },
    }));
  }
}

run().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
}).finally(async () => {
  const mongoose = await import("mongoose");
  await mongoose.default.disconnect().catch(() => {});
});

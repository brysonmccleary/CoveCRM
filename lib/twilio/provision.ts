// /lib/twilio/provision.ts
import twilio, { Twilio } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const PLATFORM_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const PLATFORM_AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN  || "";
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
const DEFAULT_AREA_CODE = (process.env.TWILIO_DEFAULT_AREA_CODE || "").trim();

if (!PLATFORM_ACCOUNT_SID || !PLATFORM_AUTH_TOKEN) {
  throw new Error("Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN envs.");
}

type ProvisionResult =
  | {
      ok: true;
      message: string;
      data: { subaccountSid: string; apiKeySid: string; phoneSid: string; phoneNumber: string };
    }
  | { ok: false; message: string; error?: string };

function buildStatusCallback(email: string) {
  return `${BASE_URL}/api/twilio/voice-status?userEmail=${encodeURIComponent(email)}`;
}

async function ensureSubaccount(master: Twilio, email: string) {
  const friendlyName = `CoveCRM - ${email}`;
  try {
    const subs = await master.api.accounts.list({ friendlyName, limit: 1 });
    if (subs?.[0]?.sid) return subs[0];
  } catch {}
  return await master.api.accounts.create({ friendlyName });
}

// TS-safe subaccount API Key creation (types don’t expose it directly)
async function ensureApiKeyForSub(master: Twilio, subAccountSid: string) {
  const m: any = master;
  const key = await m.api.v2010.accounts(subAccountSid).keys.create({
    friendlyName: "covecrm-subaccount-key",
  });
  return key as { sid: string; secret: string };
}

async function findOrBuyNumber(
  subScoped: Twilio,
  email: string,
): Promise<{ phoneSid: string; phoneNumber: string }> {
  // Reuse existing if present
  const existing = await subScoped.incomingPhoneNumbers.list({ limit: 1 });
  if (existing?.[0]?.sid && existing[0].phoneNumber) {
    return { phoneSid: (existing[0] as any).sid, phoneNumber: (existing[0] as any).phoneNumber };
  }

  // Search availability
  let candidate: any = null;

  // Parse area code to number if provided
  const AREA_CODE_NUM = Number(DEFAULT_AREA_CODE);
  const hasArea = Number.isFinite(AREA_CODE_NUM) && AREA_CODE_NUM > 0;

  if (hasArea) {
    const opts: any = {
      areaCode: AREA_CODE_NUM, // <-- number, not string
      smsEnabled: true,
      voiceEnabled: true,
      limit: 1,
    };
    const list = await (subScoped as any)
      .availablePhoneNumbers("US")
      .local.list(opts);
    candidate = list?.[0] || null;
  }

  if (!candidate) {
    const opts: any = {
      smsEnabled: true,
      voiceEnabled: true,
      limit: 1,
    };
    const list = await (subScoped as any)
      .availablePhoneNumbers("US")
      .local.list(opts);
    candidate = list?.[0] || null;
  }

  if (!candidate?.phoneNumber) throw new Error("No US local Voice+SMS numbers available right now.");

  // Buy it
  const bought = await subScoped.incomingPhoneNumbers.create({
    phoneNumber: candidate.phoneNumber,
    smsUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    smsMethod: "POST",
    voiceUrl: `${BASE_URL}/api/twilio/voice/inbound`,
    voiceMethod: "POST",
    statusCallback: buildStatusCallback(email),
    statusCallbackMethod: "POST",
    friendlyName: `CoveCRM - ${email}`,
  });

  return { phoneSid: (bought as any).sid, phoneNumber: (bought as any).phoneNumber };
}

async function applyWebhooks(subScoped: Twilio, phoneSid: string, email: string) {
  await subScoped.incomingPhoneNumbers(phoneSid).update({
    smsUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    smsMethod: "POST",
    voiceUrl: `${BASE_URL}/api/twilio/voice/inbound`,
    voiceMethod: "POST",
    statusCallback: buildStatusCallback(email),
    statusCallbackMethod: "POST",
  });
}

export async function provisionUserTwilio(email: string): Promise<ProvisionResult> {
  try {
    await dbConnect();
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) return { ok: false, message: "User not found." };

    const master = twilio(PLATFORM_ACCOUNT_SID, PLATFORM_AUTH_TOKEN);

    // 1) Subaccount
    let subSid = user?.twilio?.accountSid || "";
    if (!subSid) {
      const sub = await ensureSubaccount(master, user.email);
      subSid = (sub as any).sid;
      user.twilio = user.twilio || {};
      user.twilio.accountSid = subSid;
      await user.save();
    }

    // Scoped client to subaccount using master creds
    const subScoped = twilio(PLATFORM_ACCOUNT_SID, PLATFORM_AUTH_TOKEN, { accountSid: subSid });

    // 2) API Key
    let keySid = user?.twilio?.apiKeySid || "";
    let keySecret = user?.twilio?.apiKeySecret || "";
    if (!keySid || !keySecret) {
      const key = await ensureApiKeyForSub(master, subSid);
      keySid = key.sid;
      keySecret = key.secret;
      user.twilio = user.twilio || {};
      user.twilio.apiKeySid = keySid;
      user.twilio.apiKeySecret = keySecret;
      await user.save();
    }

    // 3) Number (buy if none)
    let phoneSid = "";
    let phoneNumber = "";

    if (Array.isArray(user.numbers) && user.numbers.length) {
      const found = await subScoped.incomingPhoneNumbers.list({ limit: 20 });
      const ownedSids = new Set(found.map((p: any) => p.sid));
      const match = user.numbers.find((n) => n.sid && ownedSids.has(n.sid));
      if (match?.sid && match.phoneNumber) {
        phoneSid = match.sid;
        phoneNumber = match.phoneNumber;
      }
    }

    if (!phoneSid) {
      const bought = await findOrBuyNumber(subScoped, user.email);
      phoneSid = bought.phoneSid;
      phoneNumber = bought.phoneNumber;

      const exists = (user.numbers || []).some((n) => n.sid === phoneSid);
      if (!exists) {
        user.numbers = user.numbers || [];
        user.numbers.push({
          sid: phoneSid,
          phoneNumber,
          purchasedAt: new Date(),
          capabilities: { voice: true, sms: true },
          friendlyName: `CoveCRM - ${user.email}`,
        } as any);
        await user.save();
      }
    }

    // 4) Webhooks
    await applyWebhooks(subScoped, phoneSid, user.email);

    return {
      ok: true,
      message: "Provisioned",
      data: { subaccountSid: subSid, apiKeySid: keySid, phoneSid, phoneNumber },
    };
  } catch (err: any) {
    return { ok: false, message: "Provisioning failed", error: err?.message || String(err) };
  }
}

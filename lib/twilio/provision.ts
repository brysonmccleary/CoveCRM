// /lib/twilio/provision.ts
import twilio, { Twilio } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { getPlatformTwilioAuth } from "@/lib/twilio/getPlatformClient";
import { isAdmin } from "@/lib/featureFlags";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
const DEFAULT_AREA_CODE = (process.env.TWILIO_DEFAULT_AREA_CODE || "").trim();

type ProvisionResult =
  | {
      ok: true;
      provisioned?: true;
      message: string;
      data: { subaccountSid: string; apiKeySid: string; phoneSid: string; phoneNumber: string };
    }
  | { ok: false; provisioned?: false; reason?: string; message: string; error?: string };

function buildStatusCallback(email: string) {
  return `${BASE_URL}/api/twilio/voice-status?userEmail=${encodeURIComponent(email)}`;
}

function getMasterClient(): Twilio {
  const auth = getPlatformTwilioAuth();
  if (auth.mode === "authToken") {
    return twilio(auth.accountSid, auth.authToken);
  }
  return twilio(auth.apiKeySid, auth.apiKeySecret, { accountSid: auth.accountSid });
}

function getSubScopedClient(subAccountSid: string): Twilio {
  const auth = getPlatformTwilioAuth();
  if (auth.mode === "authToken") {
    return twilio(auth.accountSid, auth.authToken, { accountSid: subAccountSid });
  }
  return twilio(auth.apiKeySid, auth.apiKeySecret, { accountSid: subAccountSid });
}

const PROVISION_LOCK_TTL_MS = 60_000;

async function ensureSubaccount(master: Twilio, user: any) {
  // Fast path: already provisioned.
  if (user?.twilio?.accountSid) {
    console.log("[TWILIO] Using existing subaccount:", user.twilio.accountSid);
    return { sid: user.twilio.accountSid };
  }

  const now = new Date();
  const lockExpiry = new Date(now.getTime() - PROVISION_LOCK_TTL_MS);

  // Atomically claim the provisioning lock.
  // Claim succeeds only when no accountSid is set AND no live lock exists (or the lock is stale).
  const claimed = await User.findOneAndUpdate(
    {
      _id: (user as any)._id,
      $or: [
        { "twilio.accountSid": { $exists: false } },
        { "twilio.accountSid": null },
        { "twilio.accountSid": "" },
      ],
      $and: [
        {
          $or: [
            { "twilio.provisioningLock": { $exists: false } },
            { "twilio.provisioningLock": null },
            { "twilio.provisioningLock": { $lt: lockExpiry } },
          ],
        },
      ],
    },
    { $set: { "twilio.provisioningLock": now } },
    { new: false },
  );

  if (!claimed) {
    // Another process holds a live lock. Wait briefly then check if it finished.
    await new Promise<void>((resolve) => setTimeout(resolve, 3000));
    const reloaded = await User.findById((user as any)._id).lean<any>();
    const concurrent = String(reloaded?.twilio?.accountSid || "").trim();
    if (concurrent) {
      console.log("[TWILIO] Using subaccount created by concurrent process:", concurrent);
      user.twilio = user.twilio || {};
      user.twilio.accountSid = concurrent;
      return { sid: concurrent };
    }
    throw new Error(
      `ensureSubaccount: lock held and no SID found after wait (email=${user.email})`,
    );
  }

  // Lock claimed. Create the Twilio subaccount.
  let sub: any;
  try {
    sub = await master.api.accounts.create({
      friendlyName: `CoveCRM - ${user.email}`,
    });
  } catch (createErr: any) {
    // Release lock so future attempts can retry.
    await User.updateOne(
      { _id: (user as any)._id },
      { $set: { "twilio.provisioningLock": null } },
    ).catch(() => {});
    throw createErr;
  }

  // Persist SID and release lock atomically.
  try {
    await User.findOneAndUpdate(
      { _id: (user as any)._id },
      {
        $set: { "twilio.accountSid": sub.sid, "twilio.provisioningLock": null },
      },
    );
    user.twilio = user.twilio || {};
    user.twilio.accountSid = sub.sid;
  } catch (saveErr: any) {
    // DB write failed after Twilio account was created — suspend the orphan.
    console.error(
      "[TWILIO] DB write failed after subaccount creation; suspending orphan:",
      sub.sid,
      saveErr?.message || saveErr,
    );
    try {
      await (master as any).api.accounts(sub.sid).update({ status: "suspended" });
    } catch (suspendErr: any) {
      console.error(
        "[TWILIO] Failed to suspend orphaned subaccount:",
        sub.sid,
        suspendErr?.message || suspendErr,
      );
    }
    await User.updateOne(
      { _id: (user as any)._id },
      { $set: { "twilio.provisioningLock": null } },
    ).catch(() => {});
    throw saveErr;
  }

  return sub;
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


// AUTO_ATTACH_TO_MESSAGING_SERVICE
// ✅ Attach a purchased/existing IncomingPhoneNumber to the user's Messaging Service sender pool (subaccount-safe).
// This prevents Twilio 21704 (Messaging Service contains no phone numbers) and makes texting work immediately after purchase.
async function attachNumberToMessagingService(
  subScoped: Twilio,
  phoneSid: string,
  messagingServiceSid: string,
) {
  const msid = String(messagingServiceSid || "").trim();
  const pnSid = String(phoneSid || "").trim();
  if (!msid || !pnSid) return;

  // 1) Attach PN → Messaging Service sender pool (best-effort)
  try {
    await (subScoped as any).messaging.v1
      .services(msid)
      .phoneNumbers
      .create({ phoneNumberSid: pnSid });
  } catch {
    // ignore (already attached / not allowed)
  }

  // 2) Also set Messaging Service on the IncomingPhoneNumber (best-effort)
  try {
    await (subScoped as any).incomingPhoneNumbers(pnSid).update({
      messagingServiceSid: msid,
    });
  } catch {
    // ignore
  }
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

export async function ensureUserTwilioIdentity(email: string): Promise<
  | { ok: true; message: string; data: { subaccountSid: string; apiKeySid: string } }
  | { ok: false; message: string; error?: string }
> {
  try {
    await dbConnect();
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) return { ok: false, message: "User not found." };

    // Platform-billed is the default multi-tenant mode.
    if ((user as any).billingMode !== "self") {
      (user as any).billingMode = "platform";
    }

    const master = getMasterClient();

    // 1) Subaccount
    const sub = await ensureSubaccount(master, user);
    let subSid = (sub as any).sid;

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
    }

    await user.save();

    return {
      ok: true,
      message: "Twilio identity ensured",
      data: { subaccountSid: subSid, apiKeySid: keySid },
    };
  } catch (err: any) {
    return {
      ok: false,
      message: "Twilio identity ensure failed",
      error: err?.message || String(err),
    };
  }
}

export async function provisionUserTwilio(email: string): Promise<ProvisionResult> {
  try {
    await dbConnect();
    const user = await User.findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user) return { ok: false, message: "User not found." };

    const userEmail = String(user.email || email || "").toLowerCase();
    const adminBypass = (user as any).role === "admin" || isAdmin(userEmail);
    if ((user as any).cardOnFile !== true && !adminBypass) {
      console.log(`[Twilio] Skipping number provisioning for ${email} — no card on file`);
      return {
        ok: false,
        provisioned: false,
        reason: "no_card_on_file",
        message: "No card on file.",
      };
    }

    const master = getMasterClient();

    // 1) Subaccount
    const sub = await ensureSubaccount(master, user);
    let subSid = (sub as any).sid;

    // Scoped client to subaccount using platform creds
    const subScoped = getSubScopedClient(subSid);

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

    
    // AUTO_ATTACH_TO_MESSAGING_SERVICE_CALL
    // ✅ If user already has a Messaging Service SID (A2P flow), attach the number immediately so texting works right away.
    try {
      const msid = (user as any)?.a2p?.messagingServiceSid;
      if (msid && phoneSid) {
        await attachNumberToMessagingService(subScoped, phoneSid, msid);
      }
    } catch {
      // ignore
    }

    (user as any).numberProvisionedAt = new Date();
    await user.save();

    return {
      ok: true,
      provisioned: true,
      message: "Provisioned",
      data: { subaccountSid: subSid, apiKeySid: keySid, phoneSid, phoneNumber },
    };
  } catch (err: any) {
    return { ok: false, message: "Provisioning failed", error: err?.message || String(err) };
  }
}

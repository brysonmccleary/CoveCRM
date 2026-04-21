// lib/twilio/sendSMS.ts
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import { trackUsage } from "@/lib/billing/trackUsage";
import { assertBillingAllowed } from "@/lib/billing/assertBillingAllowed";
import User from "@/models/User";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import { DateTime } from "luxon";
import { getTimezoneFromState } from "@/utils/timezone";
import { getClientForUser } from "./getClientForUser";
import { syncA2PForUser } from "@/lib/twilio/syncA2P";
import { queueLeadMemoryHook } from "@/lib/ai/memory/queueLeadMemoryHook";
import { reconcileUserNumbers } from "@/lib/twilio/reconcileUserNumbers";
import type { MessageListInstanceCreateOptions } from "twilio/lib/rest/api/v2010/account/message";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");
const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);
const DEV_ALLOW_UNAPPROVED = process.env.DEV_ALLOW_UNAPPROVED === "1";
const SMS_COST = 0.02; // $ billed per SMS segment (platform price)

const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 8;
const MIN_SCHEDULE_LEAD_MINUTES = 15;

function normalize(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

function getUserNumberEntries(user: any): any[] {
  return Array.isArray((user as any)?.numbers) ? (user as any).numbers : [];
}

function findOwnedNumberByPhone(user: any, phoneNumber: string) {
  const normalized = normalize(phoneNumber);
  if (!normalized) return null;
  return (
    getUserNumberEntries(user).find(
      (entry: any) => normalize(String(entry?.phoneNumber || "")) === normalized,
    ) || null
  );
}

function findOwnedNumberById(user: any, numberId: string) {
  if (!numberId) return null;
  return (
    getUserNumberEntries(user).find((entry: any) => {
      const entryId = entry?._id ? String(entry._id) : "";
      return entryId === numberId || String(entry?.sid || "") === numberId;
    }) || null
  );
}

function resolveStoredDefaultSmsNumber(user: any) {
  const defaultSmsNumberId = String((user as any)?.defaultSmsNumberId || "");
  const numbers = getUserNumberEntries(user);
  const defaultNumber = findOwnedNumberById(user, defaultSmsNumberId);
  const onlyNumber = numbers.length === 1 ? numbers[0] : null;

  return {
    defaultSmsNumberId,
    defaultNumber,
    onlyNumber,
    numberCount: numbers.length,
  };
}

async function verifyNumberInActiveAccount(client: any, phoneNumber: string) {
  const matches = await client.incomingPhoneNumbers.list({
    phoneNumber,
    limit: 1,
  });
  return Array.isArray(matches) && matches.length > 0;
}

async function resolveStrictSmsSender(args: {
  user: any;
  client: any;
  accountSid: string;
  requestedFrom?: string | null;
}) {
  const requestedFrom = String(args.requestedFrom || "").trim();
  const requestedNorm = requestedFrom ? normalize(requestedFrom) : "";

  if (requestedFrom && !requestedNorm) {
    throw new Error("Invalid outbound number.");
  }

  let ownedNumber = requestedNorm
    ? findOwnedNumberByPhone(args.user, requestedNorm)
    : resolveStoredDefaultSmsNumber(args.user).defaultNumber;

  if (!requestedNorm && !ownedNumber?.phoneNumber) {
    const initialState = resolveStoredDefaultSmsNumber(args.user);
    if (initialState.defaultSmsNumberId) {
      console.warn(
        JSON.stringify({
          msg: "sendSMS: defaultSmsNumberId missing from user.numbers",
          userEmail: args.user?.email || null,
          userId: args.user?._id ? String(args.user._id) : null,
          defaultSmsNumberId: initialState.defaultSmsNumberId,
          userNumberCount: initialState.numberCount,
        }),
      );
    }

    const freshUser = await ensureUserDoc(args.user?._id || args.user?.email);
    if (freshUser) {
      await reconcileUserNumbers(freshUser, freshUser.email);

      (args.user as any).numbers = (freshUser as any).numbers;
      (args.user as any).defaultSmsNumberId =
        (freshUser as any).defaultSmsNumberId;

      const refreshedState = resolveStoredDefaultSmsNumber(freshUser);

      ownedNumber =
        refreshedState.defaultNumber ||
        (refreshedState.numberCount === 1
          ? refreshedState.onlyNumber
          : null);

      if (
        ownedNumber?.phoneNumber &&
        refreshedState.numberCount === 1 &&
        refreshedState.defaultSmsNumberId
      ) {
        console.info(
          JSON.stringify({
            msg: "sendSMS: healed defaultSmsNumberId using single owned number",
            userEmail: args.user?.email || null,
            userId: args.user?._id ? String(args.user._id) : null,
            defaultSmsNumberId: refreshedState.defaultSmsNumberId,
            resolvedFrom: normalize(String(ownedNumber.phoneNumber || "")),
          }),
        );
      }
    }
  }

  if (!ownedNumber?.phoneNumber) {
    console.warn(
      JSON.stringify({
        msg: "sendSMS: outbound number not assigned",
        userEmail: args.user?.email || null,
        userId: args.user?._id ? String(args.user._id) : null,
        requestedFrom: requestedNorm || null,
      }),
    );
    throw new Error(
      requestedNorm
        ? "Requested outbound number is not assigned to this account."
        : "No assigned outbound number configured.",
    );
  }

  const resolvedFrom = normalize(String(ownedNumber.phoneNumber || ""));
  const existsInActiveAccount = await verifyNumberInActiveAccount(
    args.client,
    resolvedFrom,
  );

  if (!existsInActiveAccount) {
    console.warn(
      JSON.stringify({
        msg: "sendSMS: outbound number/account mismatch",
        userEmail: args.user?.email || null,
        userId: args.user?._id ? String(args.user._id) : null,
        accountSid: args.accountSid || null,
        requestedFrom: requestedNorm || null,
        resolvedFrom,
      }),
    );
    throw new Error("Outbound number/account mismatch.");
  }

  return resolvedFrom;
}

function isUS(num: string) {
  return (num || "").startsWith("+1");
}
function pickLeadZone(lead: any): string {
  const fromState = getTimezoneFromState(lead?.State || "");
  return fromState || "America/New_York";
}

async function ensureUserDoc(userOrId: string | any) {
  if (!userOrId) return null;
  if (typeof (userOrId as any).save === "function") return userOrId;
  if (typeof userOrId === "string") {
    if (mongoose.isValidObjectId(userOrId))
      return await User.findById(userOrId);
    return await User.findOne({ email: String(userOrId).toLowerCase() });
  }
  if (userOrId._id && mongoose.isValidObjectId(userOrId._id)) {
    const doc = await User.findById(userOrId._id);
    if (doc) return doc;
  }
  if (userOrId.email)
    return await User.findOne({ email: String(userOrId.email).toLowerCase() });
  return null;
}

async function resolveLeadForSend(opts: {
  leadId?: string | null;
  userEmail: string;
  toNorm: string;
}) {
  if (opts.leadId && mongoose.isValidObjectId(opts.leadId)) {
    const lead = await Lead.findById(opts.leadId);
    if (lead && (lead as any).userEmail?.toLowerCase() === opts.userEmail)
      return lead;
  }
  return (
    (await Lead.findOne({ userEmail: opts.userEmail, Phone: opts.toNorm })) ||
    (await Lead.findOne({
      userEmail: opts.userEmail,
      Phone: opts.toNorm.replace(/^\+1/, ""),
    })) ||
    (await Lead.findOne({
      userEmail: opts.userEmail,
      Phone: opts.toNorm.replace(/^\+/, ""),
    })) ||
    (await Lead.findOne({ ownerEmail: opts.userEmail, Phone: opts.toNorm })) ||
    (await Lead.findOne({
      ownerEmail: opts.userEmail,
      Phone: opts.toNorm.replace(/^\+1/, ""),
    })) ||
    (await Lead.findOne({
      ownerEmail: opts.userEmail,
      Phone: opts.toNorm.replace(/^\+/, ""),
    }))
  );
}

type SendCoreParams = {
  to: string;
  body: string;
  user: any;
  leadId?: string | null;
  overrideMsid?: string | null;
  from?: string | null;
  mediaUrls?: string[] | null;

  // idempotency & drip metadata
  idempotencyKey?: string | null;
  enrollmentId?: string | null;
  campaignId?: string | null;
  stepIndex?: number | null;

  // generic delay (in minutes) for non-quiet-hours scheduling (e.g. AI human-like delay)
  delayMinutesForNonQuiet?: number | null;
};

async function sendCore(
  paramsIn: SendCoreParams,
): Promise<{
  sid?: string;
  serviceSid: string;
  messageId: string;
  scheduledAt?: string;
}> {
  await dbConnect();
  const user = paramsIn.user;
  if (!user) throw new Error("User not found");
  assertBillingAllowed(user);

  const toNorm = normalize(paramsIn.to);
  if (!toNorm) throw new Error("Invalid destination phone number.");
  const isUSDest = isUS(toNorm);

  // Resolve Twilio client for this user (platform vs subaccount vs personal)
  const { client, usingPersonal, accountSid } = await getClientForUser(
    user.email,
  );

  const userA2P = (user as any).a2p || {};

  // --- Strict A2P gating for US SMS ---
// ✅ Auto-heal: if we're not marked ready, run a live sync from Twilio and re-check.
// This does NOT bypass A2P compliance — it only updates stale local state.
let isMessagingReady = userA2P.messagingReady === true;

if (isUSDest && !isMessagingReady && !DEV_ALLOW_UNAPPROVED) {
  try {
    const refreshed = await syncA2PForUser(user as any);
    const refreshedA2P = (refreshed as any)?.a2p || {};
    isMessagingReady = refreshedA2P.messagingReady === true;

    // LIVE_READY_OVERRIDE_FROM_STATUS
    // ✅ If Twilio shows the campaign is verified/approved and we have a Messaging Service,
    // proceed even if the cached messagingReady boolean is stale.
    if (!isMessagingReady) {
      const b = String(refreshedA2P.brandStatus || userA2P.brandStatus || "").toLowerCase();
      const c = String(refreshedA2P.campaignStatus || userA2P.campaignStatus || "").toLowerCase();
      const msid = String(refreshedA2P.messagingServiceSid || userA2P.messagingServiceSid || "").trim();
      const brandOk = b === "approved" || b === "active" || b === "verified";
      const campaignOk = c === "verified" || c === "approved" || c === "active";
      if (brandOk && campaignOk && msid) {
        isMessagingReady = true;
      }
    }
  } catch {
    // ignore — we'll throw the standard message below if still not ready
  }


  if (!isMessagingReady) {
    console.log(
      JSON.stringify({
        msg: "[sendSMS] BLOCKED: A2P not ready after sync",
        userEmail: user.email,
        brandStatus: (user as any)?.a2p?.brandStatus,
        campaignStatus: (user as any)?.a2p?.campaignStatus,
        brandSid: (user as any)?.a2p?.brandSid,
        campaignSid: (user as any)?.a2p?.campaignSid,
        messagingServiceSid: (user as any)?.a2p?.messagingServiceSid,
      }),
    );
    throw new Error(
      "Texting is not enabled yet. Your A2P 10DLC registration is pending or not linked.",
    );
  }
}
  const serviceSid = "";

  const lead = await resolveLeadForSend({
    leadId: paramsIn.leadId,
    userEmail: user.email,
    toNorm,
  });

  const forcedFrom = await resolveStrictSmsSender({
    user,
    client,
    accountSid,
    requestedFrom: paramsIn.from || null,
  });

  // Opt-out suppression
  if ((lead as any)?.optOut === true || (lead as any)?.unsubscribed === true) {
    const suppressed = await Message.create({
      leadId: lead?._id,
      userEmail: user.email,
      direction: "outbound",
      text: paramsIn.body,
      read: true,
      status: "suppressed",
      suppressed: true,
      reason: "opt_out",
      to: toNorm,
      from: forcedFrom || undefined,
      queuedAt: new Date(),
      idempotencyKey: paramsIn.idempotencyKey || undefined,
      enrollmentId: paramsIn.enrollmentId || undefined,
      campaignId: paramsIn.campaignId || undefined,
      stepIndex: paramsIn.stepIndex ?? undefined,
    } as any);
    if (lead?._id) {
      queueLeadMemoryHook({
        userEmail: user.email,
        leadId: String(lead._id),
        type: "sms",
        direction: "outbound",
        body: paramsIn.body,
        sourceId: String(suppressed._id),
      });
    }
    return {
      serviceSid,
      messageId: String(suppressed._id),
    };
  }

  // Quiet hours schedule + generic delay scheduling
  const zone = pickLeadZone(lead);
  const { isQuiet, scheduledAt: quietScheduledAt } =
    computeQuietHoursScheduling(zone);

  let scheduledAt: Date | undefined = quietScheduledAt;
  let reason: string | undefined =
    isQuiet && quietScheduledAt ? "scheduled_quiet_hours" : undefined;

  if (
    !scheduledAt &&
    !isQuiet &&
    paramsIn.delayMinutesForNonQuiet &&
    paramsIn.delayMinutesForNonQuiet > 0
  ) {
    const nowLocal = DateTime.now().setZone(zone);
    const dt = nowLocal.plus({ minutes: paramsIn.delayMinutesForNonQuiet });
    scheduledAt = dt.toUTC().toJSDate();
    reason = "scheduled_delay";
  }

  if (scheduledAt) {
    console.warn(
      JSON.stringify({
        msg: "sendSMS: scheduled send blocked by strict sender enforcement",
        userEmail: user.email,
        userId: user?._id ? String(user._id) : null,
        from: forcedFrom,
        scheduledAt: scheduledAt.toISOString(),
      }),
    );
    throw new Error(
      "Scheduled send requires a messaging service and is unavailable with strict outbound number enforcement.",
    );
  }

  
  // --- AUTO-GENERATE IDEMPOTENCY KEY FOR AUTOMATION ---
  if (!paramsIn.idempotencyKey) {
    if (paramsIn.enrollmentId && paramsIn.stepIndex !== null && paramsIn.stepIndex !== undefined) {
      paramsIn.idempotencyKey = `drip:${paramsIn.enrollmentId}:${paramsIn.stepIndex}`;
    } else if (paramsIn.campaignId && paramsIn.leadId && paramsIn.stepIndex !== null && paramsIn.stepIndex !== undefined) {
      paramsIn.idempotencyKey = `drip:${paramsIn.campaignId}:${paramsIn.leadId}:${paramsIn.stepIndex}`;
    } else if (paramsIn.campaignId && paramsIn.leadId) {
      paramsIn.idempotencyKey = `campaign:${paramsIn.campaignId}:${paramsIn.leadId}`;
    }
  }

  // PRE-INSERT queued row with IDEMPOTENCY KEY (this is the duplicate gate)
  let preRow: any;
  try {
    preRow = await Message.create({
      leadId: lead?._id,
      userEmail: user.email,
      direction: "outbound",
      text: paramsIn.body,
      read: true,
      status: "queued",
      suppressed: false,
      reason,
      to: toNorm,
      from: forcedFrom || undefined,
      queuedAt: new Date(),
      scheduledAt: scheduledAt ? scheduledAt : undefined,
      idempotencyKey: paramsIn.idempotencyKey || undefined,
      enrollmentId: paramsIn.enrollmentId || undefined,
      campaignId: paramsIn.campaignId || undefined,
      stepIndex: paramsIn.stepIndex ?? undefined,
    });
  } catch (err: any) {
    // Duplicate idempotencyKey → treat as already sent/queued
    if (err?.code === 11000 && paramsIn.idempotencyKey) {
      const existing = await Message.findOne({
        idempotencyKey: paramsIn.idempotencyKey,
      }).lean();
      return {
        serviceSid: existing?.fromServiceSid || serviceSid,
        messageId: String(existing?._id || ""),
      };
    }
    throw err;
  }

  const messageId = String(preRow._id);
  if (lead?._id) {
    queueLeadMemoryHook({
      userEmail: user.email,
      leadId: String(lead._id),
      type: "sms",
      direction: "outbound",
      body: paramsIn.body,
      sourceId: messageId,
    });
  }

  // Build Twilio params
  const twParams: MessageListInstanceCreateOptions = {
    to: toNorm,
    body: paramsIn.body,
    statusCallback: STATUS_CALLBACK,
  };
  if (paramsIn.mediaUrls?.length) (twParams as any).mediaUrl = paramsIn.mediaUrls;

  if (forcedFrom) {
    (twParams as any).from = forcedFrom;
  } else {
    throw new Error(
      "No assigned outbound number configured.",
    );
  }

  try {
    const tw = await client.messages.create(twParams);
    if (usingPersonal || (user as any).billingMode === "self") {
      await trackUsage({ user, amount: 0, source: "twilio-self" as any });
    } else {
      const seg = Math.max(1, Number((tw as any)?.numSegments || 1) || 1);
      await trackUsage({ user, amount: SMS_COST * seg, source: "twilio" });
    }
    const newStatus = (tw.status as string) || "accepted";
    await Message.findByIdAndUpdate(preRow._id, {
      $set: {
        sid: tw.sid,
        status: newStatus,
        sentAt: new Date(),
      },
    }).exec();
    return { sid: tw.sid, serviceSid, messageId };
  } catch (err: any) {
    const code = err?.code;
    const msg = err?.message || "Failed to send SMS";
    await Message.findByIdAndUpdate(preRow._id, {
      $set: {
        status: "error",
        errorCode: code,
        errorMessage: msg,
        failedAt: new Date(),
      },
    }).exec();
    if (code === 21610 && lead?._id) {
      try {
        await Lead.findByIdAndUpdate(lead._id, {
          $set: {
            optOut: true,
            unsubscribed: true,
            status: "Not Interested",
            updatedAt: new Date(),
          },
          $push: {
            interactionHistory: {
              type: "ai",
              text: "[system] Twilio 21610 (STOP) — lead marked Not Interested.",
              date: new Date(),
            } as any,
          },
        }).exec();
      } catch {}
    }
    throw new Error(msg);
  }
}

function computeQuietHoursScheduling(
  zone: string,
): { isQuiet: boolean; scheduledAt?: Date } {
  const nowLocal = DateTime.now().setZone(zone);
  const hour = nowLocal.hour;
  const inQuiet = hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  if (!inQuiet) return { isQuiet: false };
  let target =
    nowLocal.hour < QUIET_END_HOUR
      ? nowLocal.set({
          hour: QUIET_END_HOUR,
          minute: 0,
          second: 0,
          millisecond: 0,
        })
      : nowLocal
          .plus({ days: 1 })
          .set({
            hour: QUIET_END_HOUR,
            minute: 0,
            second: 0,
            millisecond: 0,
          });
  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const targetUtc = target.toUTC();
  const finalTarget = targetUtc < minUtc ? minUtc : targetUtc;
  return { isQuiet: true, scheduledAt: finalTarget.toJSDate() };
}

export async function sendSMS(
  to: string,
  body: string,
  userIdOrUser: string | any,
) {
  const user = await ensureUserDoc(userIdOrUser);
  if (!user) throw new Error("User not found");
  return await sendCore({ to, body, user });
}

export async function sendSms(args: {
  to: string;
  body: string;
  userEmail: string;
  leadId?: string;
  messagingServiceSid?: string;
  from?: string;
  mediaUrls?: string[];
  idempotencyKey?: string;
  enrollmentId?: string;
  campaignId?: string;
  stepIndex?: number;
  delayMinutes?: number;
}) {
  const user = await ensureUserDoc(args.userEmail);
  if (!user) throw new Error("User not found");
  return await sendCore({
    to: args.to,
    body: args.body,
    user,
    leadId: args.leadId || null,
    overrideMsid: args.messagingServiceSid || null,
    from: args.from || null,
    mediaUrls: args.mediaUrls || null,
    idempotencyKey: args.idempotencyKey || null,
    enrollmentId: args.enrollmentId || null,
    campaignId: args.campaignId || null,
    stepIndex: typeof args.stepIndex === "number" ? args.stepIndex : null,
    delayMinutesForNonQuiet:
      typeof args.delayMinutes === "number" ? args.delayMinutes : null,
  });
}

// lib/twilio/sendSMS.ts
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import { trackUsage } from "@/lib/billing/trackUsage";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import { DateTime } from "luxon";
import { getTimezoneFromState } from "@/utils/timezone";
import { getClientForUser } from "./getClientForUser";
import type { MessageListInstanceCreateOptions } from "twilio/lib/rest/api/v2010/account/message";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);
const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const DEV_ALLOW_UNAPPROVED = process.env.DEV_ALLOW_UNAPPROVED === "1";
const DEFAULT_MPS = Math.max(
  1,
  parseInt(process.env.TWILIO_DEFAULT_MPS || "1", 10) || 1,
);
const SMS_COST = 0.0075;

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
function isUS(num: string) {
  return (num || "").startsWith("+1");
}
function pickLeadZone(lead: any): string {
  const fromState = getTimezoneFromState(lead?.State || "");
  return fromState || "America/New_York";
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const senderThrottle = new Map<string, number>();
async function throttleForSender(msid: string, mps: number) {
  const now = Date.now();
  const step = Math.ceil(1000 / Math.max(1, mps));
  const next = senderThrottle.get(msid) || 0;
  const wait = Math.max(0, next - now);
  if (wait > 0) await sleep(wait);
  senderThrottle.set(msid, Date.now() + step);
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

async function ensureTenantMessagingService(
  userId: string,
  friendlyNameHint?: string,
) {
  const twilio = await import("twilio");
  const platformClient = twilio.default(
    process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN!,
    { accountSid: process.env.TWILIO_ACCOUNT_SID! },
  );
  let a2p = await A2PProfile.findOne({ userId });
  if (a2p?.messagingServiceSid) {
    try {
      await platformClient.messaging.v1.services(a2p.messagingServiceSid).update({
        friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
        inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
        statusCallback: STATUS_CALLBACK,
      });
    } catch {}
    return a2p.messagingServiceSid;
  }
  const svc = await platformClient.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: STATUS_CALLBACK,
  });
  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  } else {
    await A2PProfile.create({ userId, messagingServiceSid: svc.sid });
  }
  return svc.sid;
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

  const toNorm = normalize(paramsIn.to);
  if (!toNorm) throw new Error("Invalid destination phone number.");
  const isUSDest = isUS(toNorm);

  const { client, usingPersonal } = await getClientForUser(user.email);
  const userA2P = (user as any).a2p || {};
  const legacyA2P = await A2PProfile.findOne({
    userId: String(user._id),
  }).lean();

  let messagingServiceSid =
    paramsIn.overrideMsid ||
    userA2P.messagingServiceSid ||
    SHARED_MESSAGING_SERVICE_SID ||
    legacyA2P?.messagingServiceSid ||
    null;

  // ---- NEW: know if this send explicitly wants a delay (AI human-like) ----
  const wantsDelayedSend =
    !!(paramsIn.delayMinutesForNonQuiet && paramsIn.delayMinutesForNonQuiet > 0);

  if (paramsIn.from) messagingServiceSid = null;

  const approvedViaUser =
    !!userA2P.messagingServiceSid && userA2P.messagingReady === true;
  const approvedViaShared = Boolean(SHARED_MESSAGING_SERVICE_SID);
  const approvedViaLegacy = Boolean(legacyA2P?.messagingReady);
  if (
    isUSDest &&
    messagingServiceSid &&
    !(approvedViaUser || approvedViaShared || approvedViaLegacy || DEV_ALLOW_UNAPPROVED)
  ) {
    throw new Error(
      "Texting is not enabled yet. Your A2P 10DLC registration is pending or not linked.",
    );
  }

  const lead = await resolveLeadForSend({
    leadId: paramsIn.leadId,
    userEmail: user.email,
    toNorm,
  });

  // pick from number from thread if not provided
  let forcedFrom: string | null = paramsIn.from || null;

  // ❗ For delayed AI replies we *must* use a Messaging Service so Twilio can schedule.
  // So we only auto-force the from-number when we are NOT doing a delayed send.
  if (!forcedFrom && lead?._id && !wantsDelayedSend) {
    const lastMsg = await Message.findOne({ leadId: lead._id })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
    if (lastMsg?.direction === "inbound" && lastMsg.to)
      forcedFrom = String(lastMsg.to);
    else if (lastMsg?.from) forcedFrom = String(lastMsg.from);
    if (forcedFrom) messagingServiceSid = null;
  }

  // If someone passed a from AND also requested a delay, prefer the Messaging Service
  // so the scheduled send actually works.
  if (forcedFrom && wantsDelayedSend) {
    console.log(
      "[sendSMS] Ignoring forcedFrom to allow scheduled send via Messaging Service",
    );
    forcedFrom = null;
  }

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
      fromServiceSid: messagingServiceSid || undefined,
      queuedAt: new Date(),
      idempotencyKey: paramsIn.idempotencyKey || undefined,
      enrollmentId: paramsIn.enrollmentId || undefined,
      campaignId: paramsIn.campaignId || undefined,
      stepIndex: paramsIn.stepIndex ?? undefined,
    } as any);
    return {
      serviceSid: messagingServiceSid || "",
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
      fromServiceSid: messagingServiceSid || undefined,
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
        serviceSid: existing?.fromServiceSid || messagingServiceSid || "",
        messageId: String(existing?._id || ""),
      };
    }
    throw err;
  }

  const messageId = String(preRow._id);

  // Build Twilio params
  const twParams: MessageListInstanceCreateOptions = {
    to: toNorm,
    body: paramsIn.body,
    statusCallback: STATUS_CALLBACK,
  };
  if (paramsIn.mediaUrls?.length) (twParams as any).mediaUrl = paramsIn.mediaUrls;

  if (messagingServiceSid) {
    (twParams as any).messagingServiceSid = messagingServiceSid;
    if (scheduledAt) {
      (twParams as any).scheduleType = "fixed";
      (twParams as any).sendAt = scheduledAt;
    }
  } else if (forcedFrom) {
    (twParams as any).from = forcedFrom;
    if (scheduledAt) {
      console.warn(
        "⚠️ Requested scheduled send but no Messaging Service SID; sending immediately.",
      );
    }
  } else if (!usingPersonal) {
    const msid = await ensureTenantMessagingService(
      String(user._id),
      user.name || user.email,
    );
    (twParams as any).messagingServiceSid = msid;
    messagingServiceSid = msid;
    if (scheduledAt) {
      (twParams as any).scheduleType = "fixed";
      (twParams as any).sendAt = scheduledAt;
    }
  } else {
    throw new Error("No routing set (neither messagingServiceSid nor from).");
  }

  const mps =
    typeof userA2P.mps === "number" && userA2P.mps > 0
      ? userA2P.mps
      : DEFAULT_MPS;
  if (messagingServiceSid) await throttleForSender(messagingServiceSid, mps);

  try {
    const tw = await client.messages.create(twParams);
    if (usingPersonal || (user as any).billingMode === "self") {
      await trackUsage({ user, amount: 0, source: "twilio-self" });
    } else {
      await trackUsage({ user, amount: SMS_COST, source: "twilio" });
    }
    const newStatus = (tw.status as string) || "accepted";
    await Message.findByIdAndUpdate(preRow._id, {
      $set: {
        sid: tw.sid,
        status: newStatus,
        sentAt:
          scheduledAt && messagingServiceSid ? scheduledAt : new Date(),
      },
    }).exec();
    return scheduledAt && messagingServiceSid
      ? {
          sid: tw.sid,
          serviceSid: messagingServiceSid || "",
          messageId,
          scheduledAt: (scheduledAt as Date).toISOString(),
        }
      : { sid: tw.sid, serviceSid: messagingServiceSid || "", messageId };
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

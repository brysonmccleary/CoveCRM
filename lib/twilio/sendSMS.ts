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
const STATUS_CALLBACK = process.env.A2P_STATUS_CALLBACK_URL || (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);
const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const DEV_ALLOW_UNAPPROVED = process.env.DEV_ALLOW_UNAPPROVED === "1";
const DEFAULT_MPS = Math.max(1, parseInt(process.env.TWILIO_DEFAULT_MPS || "1", 10) || 1);

// === Pricing ===
// Base Twilio SMS price you pay (per segment). Keep fallback aligned with your old constant.
const SMS_BASE_COST = Number.isFinite(parseFloat(process.env.SMS_BASE_COST || ""))
  ? parseFloat(process.env.SMS_BASE_COST as string)
  : 0.0075;

// Multiplier markup you charge your users (covers Twilio + OpenAI etc.).
// Default = 2x as requested.
const SMS_MARKUP_MULTIPLIER = Number.isFinite(parseFloat(process.env.SMS_MARKUP_MULTIPLIER || ""))
  ? parseFloat(process.env.SMS_MARKUP_MULTIPLIER as string)
  : 2.0;

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
function isUS(num: string) { return (num || "").startsWith("+1"); }
function pickLeadZone(lead: any): string {
  const fromState = getTimezoneFromState(lead?.State || "");
  return fromState || "America/New_York";
}
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

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
    if (mongoose.isValidObjectId(userOrId)) return await User.findById(userOrId);
    return await User.findOne({ email: String(userOrId).toLowerCase() });
  }
  if (userOrId._id && mongoose.isValidObjectId(userOrId._id)) {
    const doc = await User.findById(userOrId._id);
    if (doc) return doc;
  }
  if (userOrId.email) return await User.findOne({ email: String(userOrId.email).toLowerCase() });
  return null;
}

async function ensureTenantMessagingService(userId: string, friendlyNameHint?: string) {
  const twilio = await import("twilio");
  const platformClient = twilio.default(
    process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID!,
    process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN!,
    { accountSid: process.env.TWILIO_ACCOUNT_SID! }
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
  if (a2p) { a2p.messagingServiceSid = svc.sid; await a2p.save(); }
  else { await A2PProfile.create({ userId, messagingServiceSid: svc.sid }); }
  return svc.sid;
}

async function resolveLeadForSend(opts: { leadId?: string | null; userEmail: string; toNorm: string; }) {
  if (opts.leadId && mongoose.isValidObjectId(opts.leadId)) {
    const lead = await Lead.findById(opts.leadId);
    if (lead && (lead as any).userEmail?.toLowerCase() === opts.userEmail) return lead;
  }
  return (
    (await Lead.findOne({ userEmail: opts.userEmail, Phone: opts.toNorm })) ||
    (await Lead.findOne({ userEmail: opts.userEmail, Phone: opts.toNorm.replace(/^\+1/, "") })) ||
    (await Lead.findOne({ userEmail: opts.userEmail, Phone: opts.toNorm.replace(/^\+/, "") })) ||
    (await Lead.findOne({ ownerEmail: opts.userEmail, Phone: opts.toNorm })) ||
    (await Lead.findOne({ ownerEmail: opts.userEmail, Phone: opts.toNorm.replace(/^\+1/, "") })) ||
    (await Lead.findOne({ ownerEmail: opts.userEmail, Phone: opts.toNorm.replace(/^\+/, "") }))
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

  // Idempotency & drip metadata
  idempotencyKey?: string | null;
  enrollmentId?: string | null;
  campaignId?: string | null;
  stepIndex?: number | null;

  // Explicit schedule (UTC ISO) — only with a Messaging Service
  sendAtISO?: string | null;
};

function computeQuietHoursScheduling(zone: string): { isQuiet: boolean; scheduledAt?: Date } {
  const nowLocal = DateTime.now().setZone(zone);
  const hour = nowLocal.hour;
  const inQuiet = hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
  if (!inQuiet) return { isQuiet: false };
  let target = nowLocal.hour < QUIET_END_HOUR
    ? nowLocal.set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 })
    : nowLocal.plus({ days: 1 }).set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const targetUtc = target.toUTC();
  const finalTarget = targetUtc < minUtc ? minUtc : targetUtc;
  return { isQuiet: true, scheduledAt: finalTarget.toJSDate() };
}

function enforceMinLeadDT(dt: DateTime): DateTime {
  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const asUtc = dt.toUTC();
  return asUtc < minUtc ? minUtc : asUtc;
}

// === GSM-7 vs UCS-2 detection (rough but effective for pricing) ===
const GSM7_REGEX = /^[\u0000-\u007F€£¥èéùìòÇØøÅåÄäÖöÑñÆæßÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþ^{}\\[~]|[\u0000-\u001F]|[\u007F]]*$/;
// Conservatively treat as UCS-2 if any char looks outside basic GSM-7
function isGsm7(text: string): boolean {
  if (!text) return true;
  return GSM7_REGEX.test(text);
}
function estimateSegments(text: string): number {
  if (!text) return 1;
  const gsm = isGsm7(text);
  const single = gsm ? 160 : 70;
  const concat = gsm ? 153 : 67;
  const len = text.length;
  if (len <= single) return 1;
  return Math.ceil(len / concat);
}

async function sendCore(paramsIn: SendCoreParams): Promise<{ sid?: string; serviceSid: string; messageId: string; scheduledAt?: string }> {
  await dbConnect();
  const user = paramsIn.user;
  if (!user) throw new Error("User not found");

  const toNorm = normalize(paramsIn.to);
  if (!toNorm) throw new Error("Invalid destination phone number.");
  const isUSDest = isUS(toNorm);

  const { client, usingPersonal } = await getClientForUser(user.email);
  const userA2P = (user as any).a2p || {};
  const legacyA2P = await A2PProfile.findOne({ userId: String(user._id) }).lean();

  let messagingServiceSid =
    paramsIn.overrideMsid ||
    userA2P.messagingServiceSid ||
    SHARED_MESSAGING_SERVICE_SID ||
    legacyA2P?.messagingServiceSid ||
    null;

  if (paramsIn.from) messagingServiceSid = null;

  const approvedViaUser = !!userA2P.messagingServiceSid && userA2P.messagingReady === true;
  const approvedViaShared = Boolean(SHARED_MESSAGING_SERVICE_SID);
  const approvedViaLegacy = Boolean(legacyA2P?.messagingReady);
  if (isUSDest && messagingServiceSid && !(approvedViaUser || approvedViaShared || approvedViaLegacy || DEV_ALLOW_UNAPPROVED)) {
    throw new Error("Texting is not enabled yet. Your A2P 10DLC registration is pending or not linked.");
  }

  const lead = await resolveLeadForSend({ leadId: paramsIn.leadId, userEmail: user.email, toNorm });

  // pick from number from thread if not provided
  let forcedFrom: string | null = paramsIn.from || null;
  if (!forcedFrom && lead?._id) {
    const lastMsg = await Message.findOne({ leadId: lead._id }).sort({ createdAt: -1 }).lean().exec();
    if (lastMsg?.direction === "inbound" && lastMsg.to) forcedFrom = String(lastMsg.to);
    else if (lastMsg?.from) forcedFrom = String(lastMsg.from);
    if (forcedFrom) messagingServiceSid = null;
  }

  // Opt-out suppression
  if ((lead as any)?.optOut === true || (lead as any)?.unsubscribed === true) {
    const suppressed = await Message.create({
      leadId: lead?._id, userEmail: user.email, direction: "outbound",
      text: paramsIn.body, read: true, status: "suppressed", suppressed: true, reason: "opt_out",
      to: toNorm, from: forcedFrom || undefined, fromServiceSid: messagingServiceSid || undefined, queuedAt: new Date(),
      idempotencyKey: paramsIn.idempotencyKey || undefined,
      enrollmentId: paramsIn.enrollmentId || undefined,
      campaignId: paramsIn.campaignId || undefined,
      stepIndex: paramsIn.stepIndex ?? undefined,
    } as any);
    return { serviceSid: messagingServiceSid || "", messageId: String(suppressed._id) };
  }

  // Determine scheduling
  let explicitSchedule: Date | undefined;
  if (paramsIn.sendAtISO) {
    const desired = DateTime.fromISO(paramsIn.sendAtISO);
    if (desired.isValid) {
      explicitSchedule = enforceMinLeadDT(desired).toJSDate();
    }
  }

  const zone = pickLeadZone(lead);
  const { isQuiet, scheduledAt: quietSchedule } = computeQuietHoursScheduling(zone);

  // PRE-INSERT queued row with IDEMPOTENCY KEY
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
      reason: explicitSchedule ? "scheduled_explicit" : (isQuiet ? "scheduled_quiet_hours" : undefined),
      to: toNorm,
      from: forcedFrom || undefined,
      fromServiceSid: messagingServiceSid || undefined,
      queuedAt: new Date(),
      scheduledAt: explicitSchedule || (isQuiet ? quietSchedule : undefined),
      idempotencyKey: paramsIn.idempotencyKey || undefined,
      enrollmentId: paramsIn.enrollmentId || undefined,
      campaignId: paramsIn.campaignId || undefined,
      stepIndex: paramsIn.stepIndex ?? undefined,
    });
  } catch (err: any) {
    if (err?.code === 11000 && paramsIn.idempotencyKey) {
      const existing = await Message.findOne({ idempotencyKey: paramsIn.idempotencyKey }).lean();
      return { serviceSid: existing?.fromServiceSid || messagingServiceSid || "", messageId: String(existing?._id || "") };
    }
    throw err;
  }

  const messageId = String(preRow._id);

  // Build Twilio params
  const twParams: MessageListInstanceCreateOptions = { to: toNorm, body: paramsIn.body, statusCallback: STATUS_CALLBACK };
  if (paramsIn.mediaUrls?.length) (twParams as any).mediaUrl = paramsIn.mediaUrls;

  // Ensure we have a Messaging Service if we need to schedule explicitly
  if (!forcedFrom && (!messagingServiceSid || (explicitSchedule && !messagingServiceSid))) {
    const { usingPersonal } = await getClientForUser(user.email);
    if (!usingPersonal) {
      const msid = await ensureTenantMessagingService(String(user._id), user.name || user.email);
      messagingServiceSid = msid;
    }
  }

  if (messagingServiceSid) {
    (twParams as any).messagingServiceSid = messagingServiceSid;

    // explicit schedule takes precedence
    if (explicitSchedule) {
      (twParams as any).scheduleType = "fixed";
      (twParams as any).sendAt = explicitSchedule.toISOString();
    } else if (isQuiet && quietSchedule) {
      (twParams as any).scheduleType = "fixed";
      (twParams as any).sendAt = (quietSchedule as Date).toISOString();
    }
  } else if (forcedFrom) {
    (twParams as any).from = forcedFrom;
    // note: Twilio cannot schedule from raw phone numbers; will send immediately.
  } else {
    throw new Error("No routing set (neither messagingServiceSid nor from).");
  }

  const mps = (typeof userA2P.mps === "number" && userA2P.mps > 0 ? userA2P.mps : DEFAULT_MPS);
  if (messagingServiceSid) await throttleForSender(messagingServiceSid, mps);

  try {
    const tw = await client.messages.create(twParams);

    // === BILLING UPDATE: per-segment × base × multiplier ===
    if (usingPersonal || (user as any).billingMode === "self") {
      // customer pays Twilio directly — do not double-charge
      await trackUsage({ user, amount: 0, source: "twilio-self" });
    } else {
      const segments = estimateSegments(paramsIn.body || "");
      const perMessageCharge = Number((SMS_BASE_COST * SMS_MARKUP_MULTIPLIER * Math.max(1, segments)).toFixed(6));
      await trackUsage({ user, amount: perMessageCharge, source: "twilio" });
    }

    const newStatus = (tw.status as string) || "accepted";

    const sentAt =
      (explicitSchedule && messagingServiceSid) ? explicitSchedule :
      (isQuiet && quietSchedule && messagingServiceSid) ? (quietSchedule as Date) :
      new Date();

    await Message.findByIdAndUpdate(preRow._id, {
      $set: {
        sid: tw.sid,
        status: newStatus,
        sentAt,
      },
    }).exec();

    if (explicitSchedule && messagingServiceSid) {
      return { sid: tw.sid, serviceSid: messagingServiceSid || "", messageId, scheduledAt: sentAt.toISOString() };
    }
    if (isQuiet && quietSchedule && messagingServiceSid) {
      return { sid: tw.sid, serviceSid: messagingServiceSid || "", messageId, scheduledAt: (quietSchedule as Date).toISOString() };
    }
    return { sid: tw.sid, serviceSid: messagingServiceSid || "", messageId };
  } catch (err: any) {
    const code = err?.code;
    const msg = err?.message || "Failed to send SMS";
    await Message.findByIdAndUpdate(preRow._id, {
      $set: { status: "error", errorCode: code, errorMessage: msg, failedAt: new Date() },
    }).exec();
    if (code === 21610 && lead?._id) {
      try {
        await Lead.findByIdAndUpdate(lead._id, {
          $set: { optOut: true, unsubscribed: true, status: "Not Interested", updatedAt: new Date() },
          $push: { interactionHistory: { type: "status", text: "[system] Twilio 21610 (STOP) — lead marked Not Interested.", date: new Date() } as any },
        }).exec();
      } catch {}
    }
    throw new Error(msg);
  }
}

// Public helpers

export async function sendSMS(to: string, body: string, userIdOrUser: string | any) {
  const user = await ensureUserDoc(userIdOrUser);
  if (!user) throw new Error("User not found");
  return await sendCore({ to, body, user });
}

export async function sendSms(args: {
  to: string; body: string; userEmail: string; leadId?: string;
  messagingServiceSid?: string; from?: string; mediaUrls?: string[];
  idempotencyKey?: string; enrollmentId?: string; campaignId?: string; stepIndex?: number;
  /** ISO timestamp (UTC) for Twilio fixed scheduling. */
  sendAtISO?: string;
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
    sendAtISO: args.sendAtISO || null,
  });
}

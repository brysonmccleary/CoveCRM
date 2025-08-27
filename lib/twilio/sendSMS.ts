// /lib/twilio/sendSMS.ts
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
import crypto from "crypto";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);

const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const DEV_ALLOW_UNAPPROVED = process.env.DEV_ALLOW_UNAPPROVED === "1";
const DEFAULT_MPS = Math.max(
  1,
  parseInt(process.env.TWILIO_DEFAULT_MPS || "1", 10) || 1
);

// Internal costing (platform-billed only)
const SMS_COST = 0.0075;

// Quiet hours (local to lead’s time zone)
const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8; // 8:00 AM
const MIN_SCHEDULE_LEAD_MINUTES = 15;

// Duplicate suppression window (set AI_TEST_MODE=1 or SMS_DEDUPE_WINDOW_MS for testing)
const AI_TEST_MODE = process.env.AI_TEST_MODE === "1";
const DEDUPE_WINDOW_MS =
  parseInt(process.env.SMS_DEDUPE_WINDOW_MS || "", 10) ||
  (AI_TEST_MODE ? 15_000 : 10 * 60 * 1000);

// ---------- helpers ----------
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
  if (fromState) return fromState;
  return "America/New_York";
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

/**
 * Simple in-process throttle per sender (MSID).
 * Works best when multiple sends happen within the same runtime (drip batches).
 * Not a durable queue — drip runner batches provide additional pacing.
 */
const senderThrottle = new Map<string, number>(); // msid -> nextAvailableTs
async function throttleForSender(msid: string, mps: number) {
  const now = Date.now();
  const step = Math.ceil(1000 / Math.max(1, mps));
  const next = senderThrottle.get(msid) || 0;
  const wait = Math.max(0, next - now);
  if (wait > 0) {
    console.log(`🧯 throttled msid=${msid} wait=${wait}ms`);
    await sleep(wait);
  }
  senderThrottle.set(msid, Date.now() + step);
}

/** Ensure we have a real Mongoose User document */
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
  if (userOrId.email) {
    const doc = await User.findOne({
      email: String(userOrId.email).toLowerCase(),
    });
    if (doc) return doc;
  }
  return null;
}

/**
 * Ensure (or create) a per-tenant Messaging Service with correct webhooks.
 * Only used if you do NOT supply TWILIO_MESSAGING_SERVICE_SID and there is no stored service.
 */
async function ensureTenantMessagingService(
  userId: string,
  friendlyNameHint?: string,
) {
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
    } catch {
      /* ignore */
    }
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

/** Try to resolve lead by explicit ID first; else by phone number */
async function resolveLeadForSend(opts: {
  leadId?: string | null;
  userEmail: string;
  toNorm: string;
}) {
  if (opts.leadId && mongoose.isValidObjectId(opts.leadId)) {
    const lead = await Lead.findById(opts.leadId);
    if (lead && (lead as any).userEmail?.toLowerCase() === opts.userEmail) {
      return lead;
    }
  }
  // fall back to phone lookups (handles +1 / digits-only variants)
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

/**
 * Core implementation used by both `sendSMS()` and the newer `sendSms({...})`.
 * NOW prefers an explicit `from` override. If none is provided, will
 * auto-detect the right sender number from the last message in the thread.
 * Bulletproofed with dedupe + per-lead lock to stop multi-send storms.
 */
async function sendCore(paramsIn: {
  to: string;
  body: string;
  user: any; // Mongoose User doc
  leadId?: string | null;
  overrideMsid?: string | null;
  from?: string | null;
  mediaUrls?: string[] | null;
  idempotencyKey?: string | null; // optional external key (drips can pass)
}): Promise<{ sid?: string; serviceSid: string; messageId: string; scheduledAt?: string }> {
  await dbConnect();

  const user = paramsIn.user;
  if (!user) throw new Error("User not found");

  // Freeze check (read-only; trackUsage enforces too)
  if ((user.usageBalance || 0) < -20) {
    throw new Error(
      "Usage frozen due to negative balance. Please update your payment method.",
    );
  }

  const toNorm = normalize(paramsIn.to);
  if (!toNorm) throw new Error("Invalid destination phone number.");
  const isUSDest = isUS(toNorm);

  // Resolve Twilio client for this user (personal vs platform)
  const { client, usingPersonal } = await getClientForUser(user.email);
  console.log(`📤 sendSms user=${user.email} usingPersonal=${!!usingPersonal} to=${toNorm}`);

  // Load A2P state from User first (new flow via set-a2p-state), then legacy A2PProfile
  const userA2P = (user as any).a2p || {};
  const legacyA2P = await A2PProfile.findOne({ userId: String(user._id) }).lean();

  // Decide Messaging Service (priority) with optional override
  let messagingServiceSid =
    paramsIn.overrideMsid ||
    userA2P.messagingServiceSid ||
    SHARED_MESSAGING_SERVICE_SID ||
    legacyA2P?.messagingServiceSid ||
    null;

  // If an explicit `from` is requested, FORCE direct-from path (ignore MSID)
  if (paramsIn.from) {
    messagingServiceSid = null;
  }

  // Resolve lead (prefer explicit)
  const lead = await resolveLeadForSend({
    leadId: paramsIn.leadId,
    userEmail: user.email,
    toNorm,
  });

  // --- Auto-select FROM based on thread if no explicit override ---
  let forcedFrom: string | null = paramsIn.from || null;
  if (!forcedFrom && lead?._id) {
    const lastMsg = await Message.findOne({ leadId: lead._id })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    if (lastMsg?.direction === "inbound" && lastMsg.to) {
      // Lead texted INTO this number → reply FROM that number
      forcedFrom = String(lastMsg.to);
    } else if (lastMsg?.from) {
      // Last outbound used this number
      forcedFrom = String(lastMsg.from);
    }
    if (forcedFrom) {
      messagingServiceSid = null; // force direct-from path
      console.log(`📎 thread-stick: forcing from=${forcedFrom} for lead=${String(lead?._id)}`);
    }
  }

  // If after thread-stick we still have no route, we'll try tenant MSID later.
  console.log(`🛠 initial route msid=${messagingServiceSid || "(from number path)"}`);

  // Compliance gate (US only) — only when using a Messaging Service path
  const approvedViaUser =
    !!userA2P.messagingServiceSid && userA2P.messagingReady === true;
  const approvedViaShared = Boolean(SHARED_MESSAGING_SERVICE_SID);
  const approvedViaLegacy = Boolean(legacyA2P?.messagingReady);

  if (
    isUSDest &&
    messagingServiceSid &&            // gate only if we're actually using an MSID
    !(approvedViaUser || approvedViaShared || approvedViaLegacy || DEV_ALLOW_UNAPPROVED)
  ) {
    throw new Error(
      "Texting is not enabled yet. Your A2P 10DLC registration is pending or not linked.",
    );
  }
  if (DEV_ALLOW_UNAPPROVED && isUSDest && messagingServiceSid && !approvedViaUser && !approvedViaShared && !approvedViaLegacy) {
    console.warn("[DEV] A2P not approved — sending anyway because DEV_ALLOW_UNAPPROVED=1");
  }

  // ---------- HARD DEDUPE BEFORE QUEUEING ----------
  const routeId = forcedFrom ? `from:${forcedFrom}` : (messagingServiceSid ? `msid:${messagingServiceSid}` : "route:pending");
  const dedupeKey =
    paramsIn.idempotencyKey ||
    sha1(`${user.email}|${lead?._id || ""}|${toNorm}|${routeId}|${paramsIn.body}`);

  // If route still pending, we may mint tenant MSID (non-personal) to finalize routeId
  if (routeId === "route:pending") {
    if (!usingPersonal) {
      const msid = await ensureTenantMessagingService(String(user._id), user.name || user.email);
      messagingServiceSid = msid;
      console.log(`🛠 fallback tenant MSID created/used: ${msid}`);
    } else {
      throw new Error("No routing set (neither messagingServiceSid nor from).");
    }
  }

  const finalRouteId = forcedFrom ? `from:${forcedFrom}` : `msid:${messagingServiceSid}`;
  const threshold = new Date(Date.now() - DEDUPE_WINDOW_MS);

  // 1) Per-lead lock (atomic)
  if (lead?._id) {
    const lockOk = await Lead.findOneAndUpdate(
      {
        _id: lead._id,
        $or: [
          { "outboundLock.at": { $lt: threshold } },
          { "outboundLock.key": { $ne: dedupeKey } },
          { outboundLock: { $exists: false } },
        ],
      },
      { $set: { outboundLock: { key: dedupeKey, at: new Date(), route: finalRouteId } } },
      { new: true, upsert: false }
    );
    if (!lockOk) {
      // Write a suppressed marker so the UI shows what happened
      const suppressed = await Message.create({
        leadId: lead._id,
        userEmail: user.email,
        direction: "outbound",
        text: paramsIn.body,
        read: true,
        status: "suppressed",
        suppressed: true,
        reason: "duplicate_lock",
        to: toNorm,
        from: forcedFrom || undefined,
        fromServiceSid: messagingServiceSid || undefined,
        queuedAt: new Date(),
      });
      console.log("🛑 duplicate blocked by lead lock");
      return { serviceSid: messagingServiceSid || "", messageId: String(suppressed._id) };
    }
  }

  // 2) Recent identical message check (same route + to + body)
  const recentDupe = await Message.findOne({
    userEmail: user.email,
    to: toNorm,
    text: paramsIn.body,
    ...(forcedFrom
      ? { from: forcedFrom }
      : { fromServiceSid: messagingServiceSid || undefined }),
    createdAt: { $gt: threshold },
    suppressed: { $ne: true },
  }).lean();

  if (recentDupe) {
    const suppressed = await Message.create({
      leadId: lead?._id,
      userEmail: user.email,
      direction: "outbound",
      text: paramsIn.body,
      read: true,
      status: "suppressed",
      suppressed: true,
      reason: "duplicate_recent",
      to: toNorm,
      from: forcedFrom || undefined,
      fromServiceSid: messagingServiceSid || undefined,
      queuedAt: new Date(),
    });
    console.log("🛑 duplicate blocked by recent message check");
    return { serviceSid: messagingServiceSid || "", messageId: String(suppressed._id) };
  }
  // ---------- END HARD DEDUPE ----------

  // Opt-out suppression (supports either flag) + move to Not Interested
  if ((lead as any)?.optOut === true || (lead as any)?.unsubscribed === true) {
    try {
      if (lead && (lead as any).status !== "Not Interested") {
        (lead as any).status = "Not Interested";
        (lead as any).updatedAt = new Date();
        (lead as any).interactionHistory = (lead as any).interactionHistory || [];
        (lead as any).interactionHistory.push({
          type: "system",
          text: "[system] Outbound suppressed: lead opted out — moved to Not Interested.",
          date: new Date(),
        });
        await lead.save();
      }
    } catch {/* ignore */}

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
    });
    console.log(`⚠️ suppressed reason=opt_out to=${toNorm} messageId=${suppressed._id}`);
    return { serviceSid: messagingServiceSid || "", messageId: String(suppressed._id) };
  }

  // Quiet hours compute (we schedule instead of suppressing)
  const zone = pickLeadZone(lead);
  const { isQuiet, scheduledAt } = computeQuietHoursScheduling(zone);

  // Pre-create queued Message (DB = source of truth)
  const preRow = await Message.create({
    leadId: lead?._id,
    userEmail: user.email,
    direction: "outbound",
    text: paramsIn.body,
    read: true,
    status: "queued",
    suppressed: false,
    reason: isQuiet ? "scheduled_quiet_hours" : undefined,
    to: toNorm,
    from: forcedFrom || undefined,
    fromServiceSid: messagingServiceSid || undefined,
    queuedAt: new Date(),
    scheduledAt: isQuiet && scheduledAt ? scheduledAt : undefined,
    // store dedupe metadata for later audits
    dedupeKey: dedupeKey,
    dedupeRoute: finalRouteId,
    dedupeWindowMs: DEDUPE_WINDOW_MS,
  });
  const messageId = String(preRow._id);
  console.log(
    `⏳ queued route=${finalRouteId} messageId=${messageId}`
  );

  // Build Twilio params
  const twParams: MessageListInstanceCreateOptions = {
    to: toNorm,
    body: paramsIn.body,
    statusCallback: STATUS_CALLBACK,
  };

  if (paramsIn.mediaUrls && paramsIn.mediaUrls.length) {
    (twParams as any).mediaUrl = paramsIn.mediaUrls;
  }

  if (messagingServiceSid) {
    (twParams as any).messagingServiceSid = messagingServiceSid;
    // Only MSID supports scheduling
    if (isQuiet && scheduledAt) {
      (twParams as any).scheduleType = "fixed";
      (twParams as any).sendAt = scheduledAt; // Date object
    }
  } else if (forcedFrom) {
    (twParams as any).from = forcedFrom;
    if (isQuiet && scheduledAt) {
      console.warn("⚠️ Quiet hours: cannot schedule without a Messaging Service SID; sending immediately.");
    }
  } else {
    // Should not happen (we resolved above), but just in case
    if (!usingPersonal) {
      const msid = await ensureTenantMessagingService(String(user._id), user.name || user.email);
      (twParams as any).messagingServiceSid = msid;
      messagingServiceSid = msid;
      if (isQuiet && scheduledAt) {
        (twParams as any).scheduleType = "fixed";
        (twParams as any).sendAt = scheduledAt;
      }
      console.log(`🛠 fallback tenant MSID created/used: ${msid}`);
    } else {
      throw new Error("No routing set (neither messagingServiceSid nor from).");
    }
  }

  // Throttle per MSID (simple in-process)
  const mps =
    (typeof userA2P.mps === "number" && userA2P.mps > 0 ? userA2P.mps : DEFAULT_MPS);
  if (messagingServiceSid) await throttleForSender(messagingServiceSid, mps);

  try {
    console.log(`🚀 dispatched to=${toNorm} via=${messagingServiceSid ? "MSID" : "FROM"} messageId=${messageId}`);
    const tw = await client.messages.create(twParams);

    // Billing parity
    if (usingPersonal || (user as any).billingMode === "self") {
      await trackUsage({ user, amount: 0, source: "twilio-self" });
    } else {
      await trackUsage({ user, amount: SMS_COST, source: "twilio" });
    }

    // Update the queued Message row with SID + status
    const newStatus = (tw.status as string) || "accepted";
    await Message.findByIdAndUpdate(preRow._id, {
      $set: {
        sid: tw.sid,
        status: newStatus,
        sentAt: isQuiet && scheduledAt && messagingServiceSid ? scheduledAt : new Date(),
      },
    }).exec();

    if (isQuiet && scheduledAt && messagingServiceSid) {
      console.log(
        `🕘 scheduled sid=${tw.sid} at=${(scheduledAt as Date).toISOString()} zone=${zone} messageId=${messageId}`
      );
      return {
        sid: tw.sid,
        serviceSid: messagingServiceSid || "",
        messageId,
        scheduledAt: (scheduledAt as Date).toISOString(),
      };
    } else {
      console.log(`✅ accepted sid=${tw.sid} status=${newStatus} messageId=${messageId}`);
      return { sid: tw.sid, serviceSid: messagingServiceSid || "", messageId };
    }
  } catch (err: any) {
    const code = err?.code;
    const msg = err?.message || "Failed to send SMS";
    console.error(`❌ error code=${code || "unknown"} message="${msg}" messageId=${messageId}`);

    // Special handling: 21610 STOPed recipient → mark opted-out + Not Interested
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
              type: "system",
              text: "[system] Twilio 21610 (STOP) — lead marked Not Interested.",
              date: new Date(),
            } as any,
          },
        }).exec();
        console.warn(`🚫 auto-set lead.optOut=true & status="Not Interested" due to 21610 for ${toNorm}`);
      } catch {/* ignore */}
    }

    await Message.findByIdAndUpdate(preRow._id, {
      $set: {
        status: "error",
        errorCode: code,
        errorMessage: msg,
        failedAt: new Date(),
      },
    }).exec();

    if (code === 30034) {
      throw new Error(
        "Carrier blocked message (30034). This tenant’s A2P brand/campaign isn’t fully approved yet."
      );
    }
    if (code === 30007) {
      throw new Error(
        "Carrier filtered the message (30007). Check content, opt-in, and links/shorteners."
      );
    }
    if (code === 21610) {
      throw new Error(
        "Recipient has opted out (21610). You can’t send to this number unless they reply UNSTOP."
      );
    }
    throw new Error(msg);
  }
}

/**
 * Quiet hours scheduling util
 * Given a zone and "now", return:
 * - isQuiet: boolean if we're in [21:00, 08:00) local
 * - scheduledAt: Date if we should schedule (next 08:00 local, ≥ 15 minutes from now UTC)
 */
function computeQuietHoursScheduling(zone: string): {
  isQuiet: boolean;
  scheduledAt?: Date;
} {
  const nowLocal = DateTime.now().setZone(zone);
  const hour = nowLocal.hour;
  const inQuiet = hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;

  if (!inQuiet) return { isQuiet: false };

  let target = nowLocal;
  if (hour < QUIET_END_HOUR) {
    target = nowLocal.set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  } else {
    target = nowLocal.plus({ days: 1 }).set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
  }

  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const targetUtc = target.toUTC();
  const finalTarget = targetUtc < minUtc ? minUtc : targetUtc;

  return { isQuiet: true, scheduledAt: finalTarget.toJSDate() };
}

/**
 * LEGACY: keep the original positional API for existing callers.
 */
export async function sendSMS(
  to: string,
  body: string,
  userIdOrUser: string | any,
  idempotencyKey?: string
): Promise<{ sid?: string; serviceSid: string; messageId: string; scheduledAt?: string }> {
  const user = await ensureUserDoc(userIdOrUser);
  if (!user) throw new Error("User not found");
  return await sendCore({ to, body, user, idempotencyKey: idempotencyKey || null });
}

/**
 * NEW: object-form with richer inputs.
 * Inputs: { to, body, userEmail, leadId?, messagingServiceSid?, from?, mediaUrls?, idempotencyKey? }
 */
export async function sendSms(args: {
  to: string;
  body: string;
  userEmail: string;
  leadId?: string;
  messagingServiceSid?: string;
  from?: string;
  mediaUrls?: string[];
  idempotencyKey?: string;
}): Promise<{ sid?: string; serviceSid: string; messageId: string; scheduledAt?: string }> {
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
  });
}

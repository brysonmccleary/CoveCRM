// /lib/twilio/sendSMS.ts
import twilio from "twilio";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import { trackUsage } from "@/lib/billing/trackUsage";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import Lead from "@/models/Lead";
import Message from "@/models/Message";
import { DateTime } from "luxon";
import { getTimezoneFromState } from "@/utils/timezone";

// ✅ Import the proper options type for messages.create
import type { MessageListInstanceCreateOptions } from "twilio/lib/rest/api/v2010/account/message";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;

// ✅ Dev-safe base URL (ngrok or prod first, then localhost fallback)
const BASE_URL =
  (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(
    /\/$/,
    ""
  );

const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);

const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const DEV_ALLOW_UNAPPROVED = process.env.DEV_ALLOW_UNAPPROVED === "1";
const SMS_COST = 0.0075;

// Quiet hours
const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8; // 8:00 AM
const MIN_SCHEDULE_LEAD_MINUTES = 15;

const client = twilio(accountSid, authToken);

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
  // Primary: map from State (handles America/Phoenix for AZ)
  const fromState = getTimezoneFromState(lead?.State || "");
  if (fromState) return fromState;
  // Fallback: east coast default
  return "America/New_York";
}

/**
 * Given a zone and "now", return:
 * - isQuiet: boolean if we're in [21:00, 08:00) local
 * - scheduledAt: Date if we should schedule (next 08:00 local, ≥ 15 minutes from now UTC)
 */
function computeQuietHoursScheduling(zone: string): { isQuiet: boolean; scheduledAt?: Date } {
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

  // Twilio requires ≥ 15 minutes ahead (UTC)
  const minUtc = DateTime.utc().plus({ minutes: MIN_SCHEDULE_LEAD_MINUTES });
  const targetUtc = target.toUTC();
  const finalTarget = targetUtc < minUtc ? minUtc : targetUtc;

  return { isQuiet: true, scheduledAt: finalTarget.toJSDate() };
}

/** Ensure we have a real Mongoose User document */
async function ensureUserDoc(userOrId: string | any) {
  if (!userOrId) return null;

  // Already a Mongoose doc?
  if (typeof (userOrId as any).save === "function") return userOrId;

  // String id or email
  if (typeof userOrId === "string") {
    if (mongoose.isValidObjectId(userOrId)) {
      return await User.findById(userOrId);
    }
    return await User.findOne({ email: String(userOrId).toLowerCase() });
  }

  // Object with _id or email
  if (userOrId._id && mongoose.isValidObjectId(userOrId._id)) {
    const doc = await User.findById(userOrId._id);
    if (doc) return doc;
  }
  if (userOrId.email) {
    const doc = await User.findOne({ email: String(userOrId.email).toLowerCase() });
    if (doc) return doc;
  }

  return null;
}

/**
 * Ensure (or create) a per-tenant Messaging Service with correct webhooks.
 * Only used if you do NOT supply TWILIO_MESSAGING_SERVICE_SID.
 */
async function ensureTenantMessagingService(userId: string, friendlyNameHint?: string) {
  let a2p = await A2PProfile.findOne({ userId });

  if (a2p?.messagingServiceSid) {
    try {
      await client.messaging.v1.services(a2p.messagingServiceSid).update({
        friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
        inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
        statusCallback: STATUS_CALLBACK,
      });
    } catch {
      /* ignore */
    }
    return a2p.messagingServiceSid;
  }

  const svc = await client.messaging.v1.services.create({
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

// ---------- main ----------
export async function sendSMS(
  to: string,
  body: string,
  userIdOrUser: string | any
): Promise<{ sid: string; serviceSid: string; scheduledAt?: string }> {
  await dbConnect();

  const user = await ensureUserDoc(userIdOrUser);
  if (!user) throw new Error("User not found");

  // Freeze check (read-only; trackUsage enforces too)
  if ((user.usageBalance || 0) < -20) {
    throw new Error("Usage frozen due to negative balance. Please update your payment method.");
  }

  const toNorm = normalize(to);
  if (!toNorm) throw new Error("Invalid destination phone number.");
  const isUSDest = isUS(toNorm);

  // Load tenant A2P state (if any)
  const a2p = await A2PProfile.findOne({ userId: String(user._id) }).lean();

  // Decide which Messaging Service to use:
  // 1) Prefer the shared/approved MG SID from env (your case)
  // 2) Else, use tenant-specific MG SID if present
  // 3) Else, create one for the tenant
  const messagingServiceSid =
    SHARED_MESSAGING_SERVICE_SID ||
    a2p?.messagingServiceSid ||
    (await ensureTenantMessagingService(String(user._id), user.name || user.email));

  // Compliance gate
  const approvedViaShared = Boolean(SHARED_MESSAGING_SERVICE_SID);
  const approvedViaTenant = Boolean(a2p?.messagingReady);
  if (isUSDest && !(approvedViaShared || approvedViaTenant || DEV_ALLOW_UNAPPROVED)) {
    throw new Error("Texting is not enabled yet. Your A2P 10DLC registration is pending approval.");
  }
  if (DEV_ALLOW_UNAPPROVED && isUSDest && !approvedViaShared && !approvedViaTenant) {
    console.warn("[DEV] A2P not approved — sending anyway because DEV_ALLOW_UNAPPROVED=1");
  }

  // ---------- Quiet hours logic (lead-local) ----------
  // Find lead early to determine their local zone from State
  const lead =
    (await Lead.findOne({ userEmail: user.email, Phone: toNorm })) ||
    (await Lead.findOne({ userEmail: user.email, Phone: toNorm.replace(/^\+1/, "") })) ||
    (await Lead.findOne({ userEmail: user.email, Phone: toNorm.replace(/^\+/, "") })) ||
    (await Lead.findOne({ ownerEmail: user.email, Phone: toNorm })) ||
    (await Lead.findOne({ ownerEmail: user.email, Phone: toNorm.replace(/^\+1/, "") })) ||
    (await Lead.findOne({ ownerEmail: user.email, Phone: toNorm.replace(/^\+/, "") }));

  const zone = pickLeadZone(lead);
  const { isQuiet, scheduledAt } = computeQuietHoursScheduling(zone);

  // Build Twilio send params with the correct type
  const params: MessageListInstanceCreateOptions = {
    to: toNorm,
    body,
    messagingServiceSid,
    statusCallback: STATUS_CALLBACK,
  };

  // If within quiet hours, schedule for next 8:00 AM in the lead's local time (≥ 15 min ahead)
  if (isQuiet && scheduledAt) {
    // Twilio SDK accepts Date for sendAt
    (params as any).scheduleType = "fixed";
    (params as any).sendAt = scheduledAt; // Date object
  }

  try {
    const message = await client.messages.create(params);

    // ✅ Record usage
    await trackUsage({ user, amount: SMS_COST, source: "twilio" });

    // ✅ Save to conversation (Message model) with SID for exact status updates later
    if (lead) {
      try {
        await Message.create({
          leadId: lead._id,
          userEmail: user.email,
          direction: "outbound",
          text: body,
          read: true,
          sid: message.sid, // Twilio SID
          status: message.status, // 'accepted' | 'queued' | 'scheduled' etc.
          to: toNorm,
          fromServiceSid: messagingServiceSid,
          sentAt: isQuiet && scheduledAt ? scheduledAt : new Date(), // reflect schedule time if any
        });
      } catch {
        await Message.create({
          leadId: lead._id,
          userEmail: user.email,
          direction: "outbound",
          text: body,
          read: true,
        });
      }
    } else {
      console.warn("⚠️ Outbound SMS saved, but no matching lead found for:", toNorm);
    }

    if (isQuiet && scheduledAt) {
      console.log(
        `🕘 Quiet hours: scheduled SMS to ${toNorm} at ${scheduledAt.toISOString()} (${zone}) | SID: ${message.sid}`
      );
      return { sid: message.sid, serviceSid: messagingServiceSid, scheduledAt: scheduledAt.toISOString() };
    } else {
      console.log(`✅ SMS sent to ${toNorm} | SID: ${message.sid}`);
      return { sid: message.sid, serviceSid: messagingServiceSid };
    }
  } catch (err: any) {
    if (err?.code === 30034) {
      throw new Error(
        "Carrier blocked message (30034). This tenant’s A2P brand/campaign isn’t fully approved yet."
      );
    }
    if (err?.code === 30007) {
      throw new Error(
        "Carrier filtered the message (30007). Check content, opt-in, links, and links/shorteners."
      );
    }

    console.error("❌ Twilio send error:", err);
    throw new Error(err?.message || "Failed to send SMS");
  }
}

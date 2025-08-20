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

// ✅ Twilio types (for params)
import type { MessageListInstanceCreateOptions } from "twilio/lib/rest/api/v2010/account/message";

// ✅ Base URL for webhooks
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);

// ✅ Shared MG SID (for platform-billed / shared service)
const SHARED_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;

// ✅ Allow bypass in dev if needed
const DEV_ALLOW_UNAPPROVED = process.env.DEV_ALLOW_UNAPPROVED === "1";

// ✅ Your internal costing (platform-billed only)
const SMS_COST = 0.0075;

// Quiet hours (local to lead’s time zone)
const QUIET_START_HOUR = 21; // 9:00 PM
const QUIET_END_HOUR = 8; // 8:00 AM
const MIN_SCHEDULE_LEAD_MINUTES = 15;

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
    target = nowLocal.set({
      hour: QUIET_END_HOUR,
      minute: 0,
      second: 0,
      millisecond: 0,
    });
  } else {
    target = nowLocal
      .plus({ days: 1 })
      .set({ hour: QUIET_END_HOUR, minute: 0, second: 0, millisecond: 0 });
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
 * Note: uses a platform client under the hood (legacy path); for personal accounts
 * we expect user.a2p.messagingServiceSid to be present in that account.
 */
async function ensureTenantMessagingService(
  userId: string,
  friendlyNameHint?: string,
) {
  // Legacy path uses a platform client via env creds to manage MS if needed.
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

// ---------- main ----------
export async function sendSMS(
  to: string,
  body: string,
  userIdOrUser: string | any,
): Promise<{ sid: string; serviceSid: string; scheduledAt?: string }> {
  await dbConnect();

  const user = await ensureUserDoc(userIdOrUser);
  if (!user) throw new Error("User not found");

  // Freeze check (read-only; trackUsage enforces too)
  if ((user.usageBalance || 0) < -20) {
    throw new Error(
      "Usage frozen due to negative balance. Please update your payment method.",
    );
  }

  const toNorm = normalize(to);
  if (!toNorm) throw new Error("Invalid destination phone number.");
  const isUSDest = isUS(toNorm);

  // ✅ Resolve Twilio client for this user (personal vs platform)
  const { client, usingPersonal } = await getClientForUser(user.email);

  // Load A2P state from User first (new flow via set-a2p-state), then legacy A2PProfile
  const userA2P = (user as any).a2p || {};
  const legacyA2P = await A2PProfile.findOne({ userId: String(user._id) }).lean();

  // ✅ Decide which Messaging Service to use (priority):
  // 1) user.a2p.messagingServiceSid (preferred; must exist in the *same* account you're sending from)
  // 2) SHARED_MESSAGING_SERVICE_SID (platform-wide approved)
  // 3) legacy A2PProfile.messagingServiceSid
  // 4) (platform-only) create a tenant-specific service
  let messagingServiceSid =
    userA2P.messagingServiceSid ||
    SHARED_MESSAGING_SERVICE_SID ||
    legacyA2P?.messagingServiceSid ||
    null;

  if (!messagingServiceSid && !usingPersonal) {
    // Only auto-create on platform path
    messagingServiceSid = await ensureTenantMessagingService(
      String(user._id),
      user.name || user.email,
    );
  }

  if (!messagingServiceSid) {
    // Personal path with no MS available
    throw new Error(
      "No Messaging Service linked. Please link your A2P-approved Messaging Service to your account.",
    );
  }

  // ✅ Compliance gate (US only). Approval can be via user-level MS, shared MS, or legacy A2PProfile.
  const approvedViaUser =
    !!userA2P.messagingServiceSid && userA2P.messagingReady === true;
  const approvedViaShared = Boolean(SHARED_MESSAGING_SERVICE_SID);
  const approvedViaLegacy = Boolean(legacyA2P?.messagingReady);

  if (
    isUSDest &&
    !(approvedViaUser || approvedViaShared || approvedViaLegacy || DEV_ALLOW_UNAPPROVED)
  ) {
    throw new Error(
      "Texting is not enabled yet. Your A2P 10DLC registration is pending or not linked.",
    );
  }
  if (
    DEV_ALLOW_UNAPPROVED &&
    isUSDest &&
    !approvedViaUser &&
    !approvedViaShared &&
    !approvedViaLegacy
  ) {
    console.warn(
      "[DEV] A2P not approved — sending anyway because DEV_ALLOW_UNAPPROVED=1",
    );
  }

  // ---------- Quiet hours logic (lead-local) ----------
  // Find lead early to determine their local zone from State
  const lead =
    (await Lead.findOne({ userEmail: user.email, Phone: toNorm })) ||
    (await Lead.findOne({
      userEmail: user.email,
      Phone: toNorm.replace(/^\+1/, ""),
    })) ||
    (await Lead.findOne({
      userEmail: user.email,
      Phone: toNorm.replace(/^\+/, ""),
    })) ||
    (await Lead.findOne({ ownerEmail: user.email, Phone: toNorm })) ||
    (await Lead.findOne({
      ownerEmail: user.email,
      Phone: toNorm.replace(/^\+1/, ""),
    })) ||
    (await Lead.findOne({
      ownerEmail: user.email,
      Phone: toNorm.replace(/^\+/, ""),
    }));

  const zone = pickLeadZone(lead);
  const { isQuiet, scheduledAt } = computeQuietHoursScheduling(zone);

  // Build Twilio send params with the correct type
  const params: MessageListInstanceCreateOptions = {
    to: toNorm,
    body,
    messagingServiceSid, // ✅ Always send through Messaging Service (A2P)
    statusCallback: STATUS_CALLBACK,
  };

  // If within quiet hours, schedule for next 8:00 AM in the lead's local time (≥ 15 min ahead)
  if (isQuiet && scheduledAt) {
    (params as any).scheduleType = "fixed";
    (params as any).sendAt = scheduledAt; // Date object
  }

  try {
    const message = await client.messages.create(params);

    // ✅ Billing logic: platform vs self
    if (usingPersonal || (user as any).billingMode === "self") {
      // Do NOT bill through CRM; optional zero-charge marker
      await trackUsage({ user, amount: 0, source: "twilio-self" });
    } else {
      // Bill through CRM platform
      await trackUsage({ user, amount: SMS_COST, source: "twilio" });
    }

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
      console.warn(
        "⚠️ Outbound SMS saved, but no matching lead found for:",
        toNorm,
      );
    }

    if (isQuiet && scheduledAt) {
      console.log(
        `🕘 Quiet hours: scheduled SMS to ${toNorm} at ${scheduledAt.toISOString()} (${zone}) | SID: ${message.sid}`,
      );
      return {
        sid: message.sid,
        serviceSid: messagingServiceSid,
        scheduledAt: scheduledAt.toISOString(),
      };
    } else {
      console.log(`✅ SMS sent to ${toNorm} | SID: ${message.sid}`);
      return { sid: message.sid, serviceSid: messagingServiceSid };
    }
  } catch (err: any) {
    if (err?.code === 30034) {
      throw new Error(
        "Carrier blocked message (30034). This tenant’s A2P brand/campaign isn’t fully approved yet.",
      );
    }
    if (err?.code === 30007) {
      throw new Error(
        "Carrier filtered the message (30007). Check content, opt-in, and links/shorteners.",
      );
    }

    console.error("❌ Twilio send error:", err);
    throw new Error(err?.message || "Failed to send SMS");
  }
}

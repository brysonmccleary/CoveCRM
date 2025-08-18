// lib/twilio/syncA2P.ts
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import User, { IUser } from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { sendA2PApprovedEmail, sendA2PDeclinedEmail } from "@/lib/email";

/**
 * Determine a coarse registration status used in IA2PProfile.registrationStatus
 */
function computeRegistrationStatus(opts: {
  brandStatus?: string;
  campaignStatus?: string;
  hasServiceWithNumbers: boolean;
}) {
  const b = String(opts.brandStatus || "").toLowerCase();
  const c = String(opts.campaignStatus || "").toLowerCase();

  const brandApproved = b === "approved" || b === "active";
  const brandRejected = b === "rejected";
  const campaignApproved = c === "approved" || c === "active";
  const campaignRejected = c === "rejected";

  if (brandRejected || campaignRejected) return "rejected" as const;
  if (brandApproved && campaignApproved && opts.hasServiceWithNumbers) return "ready" as const;
  if (brandApproved && !campaignApproved) return "brand_approved" as const;
  if (!brandApproved && (b === "pending" || b === "submitted")) return "brand_submitted" as const;
  if (brandApproved && (c === "pending" || c === "submitted")) return "campaign_submitted" as const;
  return "not_started" as const;
}

/**
 * Sync Twilio A2P state + numbers for a single user.
 * - Uses stored brand/campaign/service SIDs from A2PProfile when available
 * - Falls back to best-effort discovery (typed as any to avoid SDK type gaps)
 * - Updates A2PProfile + User (numbers + a2p quick fields)
 * - Sends approval/decline email on state transitions
 */
export async function syncA2PForUser(passedUser: IUser) {
  await mongooseConnect();

  // Always re-fetch the freshest user doc
  const user = await User.findById(passedUser._id).lean<IUser>().exec();
  if (!user?.email) return passedUser;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }

  const client = twilio(accountSid, authToken);

  // Pull or create A2PProfile for this user
  const userId = String(user._id);
  let profile = await A2PProfile.findOne({ userId }).exec();
  if (!profile) {
    profile = await A2PProfile.create({
      userId,
      businessName: "",
      ein: "",
      website: "",
      address: "",
      email: user.email,
      phone: "",
      contactTitle: "",
      contactFirstName: "",
      contactLastName: "",
      profileSid: "",
      sampleMessages: "",
      optInDetails: "",
      volume: "",
      optInScreenshotUrl: "",
      registrationStatus: "not_started",
    } as any);
  }

  // Existing SIDs (preferred)
  let brandSid = profile.brandSid;
  let campaignSid = profile.campaignSid;
  let messagingServiceSid = profile.messagingServiceSid;

  // --- Fetch brand status (by SID when present) ---
  let brandStatus: string | undefined;
  try {
    if (brandSid) {
      const br = await ((client.messaging.v1 as any).brandRegistrations(brandSid).fetch());
      brandStatus = br?.status;
    } else {
      // Best-effort discovery; cast as any to avoid SDK typing gaps
      const brands = await ((client.messaging.v1 as any).brandRegistrations.list?.({ limit: 50 }) ?? []);
      if (brands.length) {
        const approved =
          brands.find((b: any) => ["approved", "active"].includes(String(b?.status).toLowerCase())) ||
          brands[0];
        brandSid = approved?.brandSid || approved?.sid || approved?.id;
        brandStatus = approved?.status;
      }
    }
  } catch {
    // ignore; keep undefined
  }

  // --- Fetch campaign status (by SID when present) ---
  let campaignStatus: string | undefined;
  try {
    const campaignsApi = (client.messaging.v1 as any).campaigns;
    if (campaignSid && campaignsApi?.call) {
      // Some SDK versions expose .campaigns(cSid).fetch()
      const c = await campaignsApi(campaignSid).fetch();
      campaignStatus = c?.status;
    } else if (campaignSid && campaignsApi?.get) {
      // Other versions: campaigns.get(cSid).fetch()
      const c = await campaignsApi.get(campaignSid).fetch();
      campaignStatus = c?.status;
    } else if (campaignsApi?.list) {
      const list = await campaignsApi.list({ limit: 100 });
      if (list?.length) {
        const approved =
          list.find((c: any) => ["approved", "active"].includes(String(c?.status).toLowerCase())) ||
          list[0];
        campaignSid = approved?.sid || campaignSid;
        campaignStatus = approved?.status;
      }
    }
  } catch {
    // ignore; keep undefined
  }

  // --- Pick a Messaging Service (prefer stored/env; else first with numbers) ---
  const forceMsSid = process.env.FORCE_MESSAGING_SERVICE_SID || process.env.TWILIO_MESSAGING_SERVICE_SID;
  let messagingService: any | undefined;

  async function fetchService(sid: string) {
    try {
      return await client.messaging.v1.services(sid).fetch();
    } catch {
      return undefined;
    }
  }

  if (forceMsSid) messagingService = await fetchService(forceMsSid);
  if (!messagingService && messagingServiceSid) messagingService = await fetchService(messagingServiceSid);

  if (!messagingService) {
    try {
      const services = await client.messaging.v1.services.list({ limit: 50 });
      // Choose the first service that has at least one attached number
      for (const s of services) {
        try {
          const nums = await client.messaging.v1.services(s.sid).phoneNumbers.list({ limit: 1 });
          if (nums.length > 0) {
            messagingService = s;
            break;
          }
        } catch {
          // ignore and continue
        }
      }
      if (!messagingService && services.length) {
        messagingService = services[0];
      }
      if (messagingService) {
        messagingServiceSid = messagingService.sid;
      }
    } catch {
      // ignore
    }
  } else {
    messagingServiceSid = messagingService.sid;
  }

  // --- Pull purchased numbers from the account ---
  const twilioNumbers = await client.incomingPhoneNumbers.list({ limit: 100 });
  const mappedNumbers = twilioNumbers.map((num: any) => ({
    sid: num.sid,
    phoneNumber: num.phoneNumber,
    status: num.status,
    country: num.isoCountry,
    carrier: num.addressRequirements,
    capabilities: {
      voice: Boolean(num.capabilities?.voice),
      sms: Boolean(num.capabilities?.SMS),
      mms: Boolean(num.capabilities?.MMS),
    },
    purchasedAt: num.dateCreated,
    messagingServiceSid: num.messagingServiceSid || messagingServiceSid || undefined,
    friendlyName: num.friendlyName,
    usage: { callsMade: 0, callsReceived: 0, textsSent: 0, textsReceived: 0, cost: 0 },
  }));

  const hasServiceWithNumbers = Boolean(messagingServiceSid && mappedNumbers.length > 0);

  // --- Compute readiness + new registrationStatus
  const registrationStatus = computeRegistrationStatus({
    brandStatus,
    campaignStatus,
    hasServiceWithNumbers,
  });
  const messagingReady = registrationStatus === "ready";

  // --- Detect transitions for email
  const prevStatus = profile.registrationStatus || "not_started";
  const prevReady = Boolean(profile.messagingReady);

  const justApproved = !prevReady && messagingReady;
  const justRejected = prevStatus !== "rejected" && registrationStatus === "rejected";

  // --- Persist A2PProfile changes
  const now = new Date();
  profile.brandSid = brandSid || profile.brandSid;
  profile.campaignSid = campaignSid || profile.campaignSid;
  profile.messagingServiceSid = messagingServiceSid || profile.messagingServiceSid;
  profile.registrationStatus = registrationStatus as any;
  profile.messagingReady = messagingReady;
  profile.updatedAt = now;

  if (justApproved) {
    (profile.approvalHistory ||= []).push({ stage: "ready", at: now });
  }
  if (justRejected) {
    (profile.approvalHistory ||= []).push({ stage: "rejected", at: now });
  }

  try {
    await profile.save();
  } catch (e) {
    // non-fatal
  }

  // --- Update User shadow fields + numbers
  const updated = await User.findOneAndUpdate(
    { _id: user._id },
    {
      $set: {
        numbers: mappedNumbers,
        numbersLastSyncedAt: now,
        "a2p.brandSid": brandSid,
        "a2p.brandStatus": brandStatus,
        "a2p.campaignSid": campaignSid,
        "a2p.campaignStatus": campaignStatus,
        "a2p.messagingServiceSid": messagingServiceSid,
        "a2p.messagingReady": messagingReady,
        "a2p.lastSyncedAt": now,
      },
    },
    { new: true, upsert: false }
  ).exec();

  // --- Notify on transitions (best-effort; ignore failures)
  try {
    if (justApproved && user.email) {
      await sendA2PApprovedEmail({
        to: user.email,
        name: (user as any).name || undefined,
        dashboardUrl: process.env.NEXT_PUBLIC_BASE_URL
          ? `${process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/settings/messaging`
          : undefined,
      });
    } else if (justRejected && user.email) {
      await sendA2PDeclinedEmail({
        to: user.email,
        name: (user as any).name || undefined,
        // If Twilio returns a reason on campaign/brand objects, you could surface it here
        reason: undefined,
        helpUrl: process.env.NEXT_PUBLIC_BASE_URL
          ? `${process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/help/a2p-checklist`
          : undefined,
      });
    }
  } catch {
    // ignore notification errors
  }

  return (updated as unknown as IUser) || passedUser;
}

/** Cron helper: sync many users */
export async function syncA2PForAllUsers(limit = 500) {
  await mongooseConnect();
  const users = await User.find({}, null, { limit }).lean<IUser[]>().exec();
  const results: Array<{ email: string; ok: boolean; error?: string }> = [];

  for (const u of users) {
    try {
      await syncA2PForUser(u as any);
      results.push({ email: u.email, ok: true });
    } catch (e: any) {
      results.push({ email: u.email, ok: false, error: e?.message || "unknown" });
    }
  }

  return results;
}

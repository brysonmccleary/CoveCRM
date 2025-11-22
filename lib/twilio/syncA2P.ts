// /lib/twilio/syncA2P.ts
import mongooseConnect from "@/lib/mongooseConnect";
import User, { IUser } from "@/models/User";
import A2PProfile, {
  A2PRegistrationStatus,
  A2PApplicationStatus,
} from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { sendA2PApprovedEmail, sendA2PDeclinedEmail } from "@/lib/email";
import { chargeA2PApprovalIfNeeded } from "@/lib/billing/trackUsage";

/**
 * Determine a coarse registration status used in IA2PProfile.registrationStatus
 */
function computeRegistrationStatus(opts: {
  brandStatus?: string;
  campaignStatus?: string;
  hasNumbers: boolean;
}): A2PRegistrationStatus {
  const b = String(opts.brandStatus || "").toLowerCase();
  const c = String(opts.campaignStatus || "").toLowerCase();

  const brandApproved = b === "approved" || b === "active";
  const brandRejected = b === "rejected";
  const campaignApproved = c === "approved" || c === "active";
  const campaignRejected = c === "rejected";

  if (brandRejected || campaignRejected) return "rejected";
  if (brandApproved && campaignApproved && opts.hasNumbers) return "ready";
  if (brandApproved && !campaignApproved) return "brand_approved";
  if (!brandApproved && (b === "pending" || b === "submitted"))
    return "brand_submitted";
  if (brandApproved && (c === "pending" || c === "submitted"))
    return "campaign_submitted";
  return "not_started";
}

function computeApplicationStatus(
  registrationStatus: A2PRegistrationStatus,
): A2PApplicationStatus {
  if (registrationStatus === "ready") return "approved";
  if (registrationStatus === "rejected") return "declined";
  return "pending";
}

/**
 * Sync Twilio A2P state + numbers for a single user.
 * - Uses getClientForUser(email) so we hit the correct Twilio account (master vs subaccount)
 * - Uses stored brand/campaign/service SIDs from A2PProfile when available
 * - Falls back to best-effort discovery (typed as any to avoid SDK type gaps)
 * - Updates A2PProfile + User (numbers + a2p quick fields)
 * - Marks PhoneNumber.a2pApproved based on readiness
 * - Sends approval/decline email on state transitions
 * - Bills one-time A2P approval fee when first becoming ready
 */
export async function syncA2PForUser(passedUser: IUser) {
  await mongooseConnect();

  // Always re-fetch the freshest user doc
  const user = await User.findById(passedUser._id).lean<IUser>().exec();
  if (!user?.email) return passedUser;

  // Resolve the correct Twilio client + accountSid (master OR subaccount OR personal)
  const { client, accountSid } = await getClientForUser(user.email);

  const platformAccountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const isPlatformAccount =
    platformAccountSid && accountSid === platformAccountSid;

  // Pull or create A2PProfile for this user
  const userId = String(user._id);
  let profile = await A2PProfile.findOne({ userId }).exec();
  if (!profile) {
    // Minimal placeholder; real data should be filled during registration flow
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
    const messagingV1 = (client.messaging.v1 as any) || {};
    if (brandSid && messagingV1.brandRegistrations) {
      const br = await messagingV1.brandRegistrations(brandSid).fetch();
      brandStatus = br?.status;
    } else if (messagingV1.brandRegistrations?.list) {
      // Best-effort discovery: use approved/active first, else first returned
      const brands =
        (await messagingV1.brandRegistrations.list({ limit: 50 })) || [];
      if (brands.length) {
        const approved =
          brands.find((b: any) =>
            ["approved", "active"].includes(
              String(b?.status).toLowerCase(),
            ),
          ) || brands[0];
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
    const campaignsApi = (client.messaging.v1 as any)?.campaigns;
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
          list.find((c: any) =>
            ["approved", "active"].includes(
              String(c?.status).toLowerCase(),
            ),
          ) || list[0];
        campaignSid = approved?.sid || campaignSid;
        campaignStatus = approved?.status;
      }
    }
  } catch {
    // ignore; keep undefined
  }

  // --- Pick a Messaging Service (platform account only) ---
  // For subaccounts / personal accounts, we do NOT apply shared/platform MS SIDs from env.
  const envForceMsSid = isPlatformAccount
    ? process.env.FORCE_MESSAGING_SERVICE_SID ||
      process.env.TWILIO_MESSAGING_SERVICE_SID
    : undefined;

  const messagingV1 = (client.messaging.v1 as any) || {};
  let messagingService: any | undefined;

  async function fetchService(sid: string) {
    try {
      return await messagingV1.services(sid).fetch();
    } catch {
      return undefined;
    }
  }

  if (envForceMsSid && messagingV1.services) {
    messagingService = await fetchService(envForceMsSid);
  }
  if (!messagingService && messagingServiceSid && messagingV1.services) {
    messagingService = await fetchService(messagingServiceSid);
  }

  if (!messagingService && messagingV1.services?.list) {
    try {
      const services = await messagingV1.services.list({ limit: 50 });
      // Prefer a service that actually has numbers attached
      for (const s of services) {
        try {
          const nums = await messagingV1.services(s.sid).phoneNumbers.list({
            limit: 1,
          });
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
      // ignore; no services available in this account
    }
  } else if (messagingService) {
    messagingServiceSid = messagingService.sid;
  }

  // --- Pull purchased numbers from THIS Twilio account ---
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
    messagingServiceSid:
      num.messagingServiceSid || messagingServiceSid || undefined,
    friendlyName: num.friendlyName,
    usage: {
      callsMade: 0,
      callsReceived: 0,
      textsSent: 0,
      textsReceived: 0,
      cost: 0,
    },
  }));

  // For readiness, we only require:
  // - Brand approved
  // - Campaign approved
  // - At least one number in this account
  const hasNumbers = mappedNumbers.length > 0;

  // --- Compute readiness + new registrationStatus
  const registrationStatus = computeRegistrationStatus({
    brandStatus,
    campaignStatus,
    hasNumbers,
  });
  const messagingReady = registrationStatus === "ready";
  const applicationStatus = computeApplicationStatus(registrationStatus);

  // --- Detect transitions for email + billing
  const prevStatus: A2PRegistrationStatus =
    (profile.registrationStatus as A2PRegistrationStatus) || "not_started";
  const prevReady = Boolean(profile.messagingReady);

  const justApproved = !prevReady && messagingReady;
  const justRejected =
    prevStatus !== "rejected" && registrationStatus === "rejected";

  // --- Persist A2PProfile changes
  const now = new Date();
  profile.brandSid = brandSid || profile.brandSid;
  profile.campaignSid = campaignSid || profile.campaignSid;
  profile.messagingServiceSid =
    messagingServiceSid || profile.messagingServiceSid;
  profile.registrationStatus = registrationStatus;
  profile.messagingReady = messagingReady;
  profile.applicationStatus = applicationStatus;
  profile.lastSyncedAt = now;
  profile.updatedAt = now;

  if (justApproved) {
    (profile.approvalHistory ||= []).push({ stage: "ready", at: now });
  }
  if (justRejected) {
    (profile.approvalHistory ||= []).push({ stage: "rejected", at: now });
  }

  try {
    await profile.save();
  } catch {
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
        "a2p.applicationStatus": applicationStatus,
        "a2p.lastSyncedAt": now,
      },
    },
    { new: true, upsert: false },
  ).exec();

  // --- Mark PhoneNumber.a2pApproved for this user
  try {
    const userScoped = { userId: userId };
    await PhoneNumber.updateMany(userScoped, {
      $set: { a2pApproved: messagingReady },
    }).exec();
  } catch {
    // non-fatal; do not break sync if PhoneNumber model fails
  }

  // --- Notify on transitions (best-effort; ignore failures)
  try {
    if (justApproved && user.email) {
      await sendA2PApprovedEmail({
        to: user.email,
        name: (user as any).name || undefined,
        dashboardUrl: process.env.NEXT_PUBLIC_BASE_URL
          ? `${process.env.NEXT_PUBLIC_BASE_URL.replace(
              /\/$/,
              "",
            )}/settings/messaging`
          : undefined,
      });
    } else if (justRejected && user.email) {
      await sendA2PDeclinedEmail({
        to: user.email,
        name: (user as any).name || undefined,
        reason: undefined,
        helpUrl: process.env.NEXT_PUBLIC_BASE_URL
          ? `${process.env.NEXT_PUBLIC_BASE_URL.replace(
              /\/$/,
              "",
            )}/help/a2p-checklist`
          : undefined,
      });
    }
  } catch {
    // ignore notification errors
  }

  // --- Bill one-time A2P approval fee on first "ready" transition ---
  if (justApproved) {
    try {
      await chargeA2PApprovalIfNeeded({ user: updated || user });
    } catch (e: any) {
      console.warn(
        "[A2P billing] chargeA2PApprovalIfNeeded failed:",
        e?.message || e,
      );
    }
  }

  return ((updated as unknown as IUser) || passedUser) as IUser;
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
      results.push({
        email: u.email,
        ok: false,
        error: e?.message || "unknown",
      });
    }
  }

  return results;
}

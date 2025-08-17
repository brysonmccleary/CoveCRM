// lib/twilio/syncA2P.ts
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import User, { IUser } from "@/models/User";

/**
 * Sync Twilio A2P state + numbers into the user document.
 * - Finds approved brand/campaign
 * - Picks a Messaging Service that has numbers (or forced via env)
 * - Marks messagingReady based on real Twilio state
 * - Atomic update to avoid version conflicts
 */
export async function syncA2PForUser(passedUser: IUser) {
  await mongooseConnect();

  // Always refetch the freshest user doc
  const user = await User.findOne({ _id: passedUser._id }).lean<IUser>().exec();
  if (!user?.email) return passedUser;

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) {
    throw new Error("Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN");
  }

  const client = twilio(accountSid, authToken);

  // --- Brand + Campaign (prefer approved/active) ---
  let brandSid: string | undefined;
  let brandStatus: string | undefined;
  let campaignSid: string | undefined;
  let campaignStatus: string | undefined;

  try {
    const brands = await client.messaging.v1.brandRegistrations.list({ limit: 50 });
    if (brands?.length) {
      const approvedBrand =
        brands.find((b: any) => ["approved", "active"].includes(String(b.status).toLowerCase())) ||
        brands[0];
      // @ts-ignore various shapes across accounts
      brandSid = approvedBrand?.brandSid || approvedBrand?.sid || approvedBrand?.id;
      brandStatus = approvedBrand?.status;
    }
  } catch (_) {
    // non-fatal
  }

  try {
    const campaigns = await client.messaging.v1.campaigns.list({ limit: 100 });
    if (campaigns?.length) {
      const approvedCamp =
        campaigns.find((c: any) => ["approved", "active"].includes(String(c.status).toLowerCase())) ||
        campaigns[0];
      campaignSid = approvedCamp?.sid;
      campaignStatus = approvedCamp?.status;
    }
  } catch (_) {
    // non-fatal
  }

  // --- Pick a Messaging Service that *actually has numbers* (or force via env) ---
  const forceMsSid = process.env.FORCE_MESSAGING_SERVICE_SID;
  let messagingService: any | undefined;

  if (forceMsSid) {
    try {
      messagingService = await client.messaging.v1.services(forceMsSid).fetch();
      // if fetch fails, we'll fall back to discovery below
    } catch (e) {
      console.warn("FORCE_MESSAGING_SERVICE_SID not found:", forceMsSid);
    }
  }

  if (!messagingService) {
    const services = await client.messaging.v1.services.list({ limit: 50 });

    async function serviceHasNumbers(serviceSid: string) {
      try {
        const nums = await client.messaging.v1.services(serviceSid).phoneNumbers.list({ limit: 1 });
        return nums.length > 0;
      } catch {
        return false;
      }
    }

    // Prefer first service that reports at least one attached number
    for (const s of services) {
      if (await serviceHasNumbers(s.sid)) {
        messagingService = s;
        break;
      }
    }

    // Fallback: if none reported, at least pick the first service
    if (!messagingService && services.length) messagingService = services[0];
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
    messagingServiceSid: num.messagingServiceSid || messagingService?.sid || undefined,
    friendlyName: num.friendlyName,
    usage: { callsMade: 0, callsReceived: 0, textsSent: 0, textsReceived: 0, cost: 0 },
  }));

  // --- Compute readiness strictly from Twilio's state ---
  const hasApprovedBrand = ["approved", "active"].includes(String(brandStatus).toLowerCase());
  const hasApprovedCampaign = ["approved", "active"].includes(String(campaignStatus).toLowerCase());
  const hasServiceWithNumbers = Boolean(messagingService?.sid && mappedNumbers.length > 0);

  const messagingReady = Boolean(hasApprovedBrand && hasApprovedCampaign && hasServiceWithNumbers);

  // --- Atomic UPDATE ---
  const now = new Date();
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
        "a2p.messagingServiceSid": messagingService?.sid,
        "a2p.messagingReady": messagingReady,
        "a2p.lastSyncedAt": now,
      },
    },
    { new: true, upsert: false }
  ).exec();

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

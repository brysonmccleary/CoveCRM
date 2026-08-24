import { stripe } from "@/lib/stripe";
import { isPhoneNumberSubscription } from "@/lib/billing/stripePlanClassification";
import {
  getPlatformTwilioAuth,
  getPlatformTwilioClient,
} from "@/lib/twilio/getPlatformClient";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import A2PProfile from "@/models/A2PProfile";
import A2PVerification from "@/models/A2PVerification";
import NumberModel from "@/models/Number";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";

type CleanupFailure = {
  resource: string;
  sid?: string;
  message: string;
};

export type TelephonyCleanupResult = {
  releasedNumbers: string[];
  canceledPhoneSubscriptions: string[];
  deletedA2PCampaigns: string[];
  deletedMessagingServices: string[];
  closedSubaccount: string | null;
  clearedLocalState: boolean;
  failures: CleanupFailure[];
  complete: boolean;
};

const log = (msg: string, extra?: Record<string, unknown>) => {
  try {
    console.info(`[release-user-telephony] ${msg}`, extra || {});
  } catch {}
};

const errorMessage = (error: any) => String(error?.message || error || "unknown error");

const isTwilioNotFound = (error: any) =>
  error?.status === 404 ||
  error?.code === 20404 ||
  /not found|no record/i.test(errorMessage(error));

function emptyResult(): TelephonyCleanupResult {
  return {
    releasedNumbers: [],
    canceledPhoneSubscriptions: [],
    deletedA2PCampaigns: [],
    deletedMessagingServices: [],
    closedSubaccount: null,
    clearedLocalState: false,
    failures: [],
    complete: false,
  };
}

async function resolveCleanupClient(user: any) {
  const accountSid = String(user?.twilio?.accountSid || "").trim();
  const platformAccountSid = getPlatformTwilioAuth().accountSid;
  const isPlatformSubaccount =
    user?.billingMode !== "self" &&
    accountSid.startsWith("AC") &&
    accountSid !== platformAccountSid;

  // Messaging/TrustHub endpoints do not carry AccountSid in their URL. Using
  // parent credentials with a scoped SDK client therefore still lists parent
  // Messaging Services. Tenant API keys are required for true A2P isolation.
  const resolved = await getClientForUser(String(user.email || ""));
  return {
    client: resolved.client,
    accountSid: accountSid || resolved.accountSid,
    platformAccountSid,
    isPlatformSubaccount,
  };
}

/** Delete all recurring-fee A2P Campaigns and their now-unused services. */
export async function releaseUserA2PResources(args: {
  userId: string;
  reason: string;
  deleteMessagingServices?: boolean;
}): Promise<
  Pick<
    TelephonyCleanupResult,
    "deletedA2PCampaigns" | "deletedMessagingServices" | "failures" | "complete"
  >
> {
  const { userId, reason, deleteMessagingServices = true } = args;
  const deletedA2PCampaigns: string[] = [];
  const deletedMessagingServices: string[] = [];
  const failures: CleanupFailure[] = [];

  const user = await User.findById(userId).lean<any>();
  if (!user) return { deletedA2PCampaigns, deletedMessagingServices, failures, complete: true };

  let resolved: Awaited<ReturnType<typeof resolveCleanupClient>>;
  try {
    resolved = await resolveCleanupClient(user);
  } catch (error: any) {
    failures.push({ resource: "twilio_client", message: errorMessage(error) });
    return { deletedA2PCampaigns, deletedMessagingServices, failures, complete: false };
  }

  const otherAccountOwners = resolved.accountSid
    ? await User.countDocuments({
        _id: { $ne: user._id },
        "twilio.accountSid": resolved.accountSid,
      })
    : 0;
  const mayEnumerateWholeAccount = resolved.isPlatformSubaccount && otherAccountOwners === 0;

  const profile = await A2PProfile.findOne({
    $or: [{ userId: String(user._id) }, { userEmail: String(user.email || "").toLowerCase() }],
  }).lean<any>();

  const knownServiceSids = new Set<string>();
  const addServiceSid = (value: unknown) => {
    const sid = String(value || "").trim();
    if (sid.startsWith("MG")) knownServiceSids.add(sid);
  };
  addServiceSid(user?.a2p?.messagingServiceSid);
  addServiceSid(profile?.messagingServiceSid);
  for (const number of Array.isArray(user?.numbers) ? user.numbers : []) {
    addServiceSid(number?.messagingServiceSid);
  }

  if (mayEnumerateWholeAccount) {
    try {
      const services = await (resolved.client as any).messaging.v1.services.list({ limit: 1000 });
      for (const service of services || []) addServiceSid(service?.sid);
    } catch (error: any) {
      failures.push({ resource: "messaging_services_list", message: errorMessage(error) });
    }
  }

  for (const serviceSid of knownServiceSids) {
    const serviceFailureStart = failures.length;
    try {
      const campaigns = await (resolved.client as any).messaging.v1
        .services(serviceSid)
        .usAppToPerson.list({ limit: 1000 });
      for (const campaign of campaigns || []) {
        const campaignSid = String(campaign?.sid || "").trim();
        if (!campaignSid) continue;
        try {
          await (resolved.client as any).messaging.v1
            .services(serviceSid)
            .usAppToPerson(campaignSid)
            .remove();
          deletedA2PCampaigns.push(campaignSid);
          log("A2P campaign deleted", { reason, userId, serviceSid, campaignSid });
        } catch (error: any) {
          if (isTwilioNotFound(error)) {
            deletedA2PCampaigns.push(campaignSid);
          } else {
            failures.push({
              resource: "a2p_campaign",
              sid: campaignSid,
              message: errorMessage(error),
            });
          }
        }
      }
    } catch (error: any) {
      if (!isTwilioNotFound(error)) {
        failures.push({
          resource: "a2p_campaign_list",
          sid: serviceSid,
          message: errorMessage(error),
        });
      }
    }

    if (deleteMessagingServices) {
      // Twilio documents that deleting an A2P-enabled Messaging Service also
      // deletes its Campaign, so this is both cleanup and a deletion backstop.
      try {
        await (resolved.client as any).messaging.v1.services(serviceSid).remove();
        deletedMessagingServices.push(serviceSid);
        failures.splice(serviceFailureStart, failures.length - serviceFailureStart);
        log("Messaging Service deleted", { reason, userId, serviceSid });
      } catch (error: any) {
        if (isTwilioNotFound(error)) {
          deletedMessagingServices.push(serviceSid);
          failures.splice(serviceFailureStart, failures.length - serviceFailureStart);
        } else {
          failures.push({
            resource: "messaging_service",
            sid: serviceSid,
            message: errorMessage(error),
          });
        }
      }
    }
  }

  return {
    deletedA2PCampaigns,
    deletedMessagingServices,
    failures,
    complete: failures.length === 0,
  };
}

/**
 * When a user releases their final number, the A2P Campaign is no longer
 * usable but would continue its monthly carrier fee. Keep the Twilio identity
 * available for future purchases while removing only A2P/service resources.
 */
export async function releaseLastNumberA2PResources(args: {
  userId: string;
  reason: string;
}) {
  const user = await User.findById(args.userId).lean<any>();
  if (!user || (Array.isArray(user.numbers) && user.numbers.length > 0)) {
    return {
      deletedA2PCampaigns: [] as string[],
      deletedMessagingServices: [] as string[],
      failures: [] as CleanupFailure[],
      complete: true,
      skipped: true,
    };
  }

  const result = await releaseUserA2PResources(args);
  if (result.complete) {
    const email = String(user.email || "").toLowerCase();
    await Promise.all([
      User.updateOne({ _id: user._id }, { $unset: { a2p: 1 } }),
      A2PProfile.deleteMany({
        $or: [{ userId: String(user._id) }, { userEmail: email }],
      }),
      A2PVerification.deleteMany({ userEmail: email }),
    ]);
  }
  return { ...result, skipped: false };
}

/**
 * Terminal cleanup for a user whose CRM plan ended. It is idempotent, stops
 * Stripe phone add-ons, deletes A2P Campaigns, releases numbers, and clears
 * local ownership. Subaccount closure is opt-in because it is irreversible
 * and is not required to stop recurring Twilio charges.
 */
export async function releaseUserPhoneNumbers(args: {
  userId: string;
  reason: string;
  closeSubaccount?: boolean;
  deleteMessagingServices?: boolean;
}): Promise<TelephonyCleanupResult> {
  const {
    userId,
    reason,
    closeSubaccount = false,
    deleteMessagingServices = true,
  } = args;
  const result = emptyResult();
  const user = await User.findById(userId).lean<any>();
  if (!user) return { ...result, complete: true, clearedLocalState: true };

  const email = String(user.email || "").toLowerCase().trim();
  if (user.isOwner === true || user.role === "owner" || user.role === "admin") {
    result.failures.push({ resource: "protected_account", message: "Owner/admin cleanup blocked" });
    return result;
  }

  const customerId = String(user.stripeCustomerId || "").trim();
  if (customerId) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
      });
      const phoneSubscriptions = subscriptions.data.filter(
        (subscription) =>
          isPhoneNumberSubscription(subscription) &&
          ["active", "trialing", "past_due", "incomplete"].includes(subscription.status),
      );
      for (const subscription of phoneSubscriptions) {
        try {
          await stripe.subscriptions.cancel(subscription.id);
          result.canceledPhoneSubscriptions.push(subscription.id);
          log("phone subscription canceled", { reason, email, subscriptionId: subscription.id });
        } catch (error: any) {
          result.failures.push({
            resource: "stripe_phone_subscription",
            sid: subscription.id,
            message: errorMessage(error),
          });
        }
      }
    } catch (error: any) {
      result.failures.push({ resource: "stripe_subscriptions_list", message: errorMessage(error) });
    }
  }

  const a2p = await releaseUserA2PResources({ userId, reason, deleteMessagingServices });
  result.deletedA2PCampaigns.push(...a2p.deletedA2PCampaigns);
  result.deletedMessagingServices.push(...a2p.deletedMessagingServices);
  result.failures.push(...a2p.failures);

  let resolved: Awaited<ReturnType<typeof resolveCleanupClient>> | null = null;
  try {
    resolved = await resolveCleanupClient(user);
  } catch (error: any) {
    if (Array.isArray(user.numbers) && user.numbers.length > 0) {
      result.failures.push({ resource: "twilio_client", message: errorMessage(error) });
    }
  }

  if (resolved) {
    for (const number of Array.isArray(user.numbers) ? user.numbers : []) {
      const phoneNumber = String(number?.phoneNumber || "").trim();
      const sid = String(number?.sid || "").trim();
      try {
        if (sid) {
          await (resolved.client as any).incomingPhoneNumbers(sid).remove();
        } else if (phoneNumber) {
          const matches = await (resolved.client as any).incomingPhoneNumbers.list({
            phoneNumber,
            limit: 1,
          });
          if (matches?.[0]?.sid) {
            await (resolved.client as any).incomingPhoneNumbers(matches[0].sid).remove();
          }
        }
        result.releasedNumbers.push(phoneNumber || sid);
        log("number released", { reason, email, phoneNumber });
      } catch (error: any) {
        if (isTwilioNotFound(error)) {
          result.releasedNumbers.push(phoneNumber || sid);
        } else {
          result.failures.push({
            resource: "twilio_number",
            sid: sid || phoneNumber,
            message: errorMessage(error),
          });
        }
      }
    }

    const otherAccountOwners = resolved.accountSid
      ? await User.countDocuments({
          _id: { $ne: user._id },
          "twilio.accountSid": resolved.accountSid,
        })
      : 0;
    if (closeSubaccount && resolved.isPlatformSubaccount && otherAccountOwners === 0) {
      try {
        await (getPlatformTwilioClient() as any).api.v2010
          .accounts(resolved.accountSid)
          .update({ status: "closed" });
        result.closedSubaccount = resolved.accountSid;
        log("platform subaccount closed", { reason, email, accountSid: resolved.accountSid });
      } catch (error: any) {
        if (/closed/i.test(errorMessage(error)) || isTwilioNotFound(error)) {
          result.closedSubaccount = resolved.accountSid;
        } else {
          result.failures.push({
            resource: "twilio_subaccount",
            sid: resolved.accountSid,
            message: errorMessage(error),
          });
        }
      }
    } else if (closeSubaccount && resolved.isPlatformSubaccount && otherAccountOwners > 0) {
      result.failures.push({
        resource: "twilio_subaccount",
        sid: resolved.accountSid,
        message: `Subaccount is shared by ${otherAccountOwners + 1} users; closure blocked`,
      });
    }
  }

  const failedNumberIds = new Set(
    result.failures
      .filter((failure) => failure.resource === "twilio_number")
      .map((failure) => String(failure.sid || "")),
  );
  const remainingNumbers = result.closedSubaccount
    ? []
    : (Array.isArray(user.numbers) ? user.numbers : []).filter((number: any) => {
        const sid = String(number?.sid || "");
        const phone = String(number?.phoneNumber || "");
        return failedNumberIds.has(sid) || failedNumberIds.has(phone);
      });

  try {
    const a2pCleared = a2p.complete || Boolean(result.closedSubaccount);
    const update: any = {
      $set: {
        numbers: remainingNumbers,
        defaultSmsNumberId: null,
        numberProvisionedAt: null,
        numbersLastSyncedAt: new Date(),
      },
      $unset: {},
    };
    if (a2pCleared) update.$unset.a2p = 1;
    if (result.closedSubaccount) {
      update.$unset.twilio = 1;
      update.$unset.twimlAppSid = 1;
    }
    await User.updateOne({ _id: user._id }, update);

    const remainingPhones = remainingNumbers
      .map((number: any) => String(number?.phoneNumber || ""))
      .filter(Boolean);
    const remainingSids = remainingNumbers
      .map((number: any) => String(number?.sid || ""))
      .filter(Boolean);
    const localCleanup: Promise<any>[] = [
      remainingNumbers.length === 0
        ? PhoneNumber.deleteMany({ userId: user._id })
        : PhoneNumber.deleteMany({
            userId: user._id,
            phoneNumber: { $nin: remainingPhones },
            twilioSid: { $nin: remainingSids },
          }),
      remainingNumbers.length === 0
        ? NumberModel.deleteMany({ userEmail: email })
        : NumberModel.deleteMany({
            userEmail: email,
            phoneNumber: { $nin: remainingPhones },
            sid: { $nin: remainingSids },
          }),
    ];
    if (a2pCleared) {
      localCleanup.push(
        A2PProfile.deleteMany({
          $or: [{ userId: String(user._id) }, { userEmail: email }],
        }),
        A2PVerification.deleteMany({ userEmail: email }),
      );
    }
    await Promise.all(localCleanup);
    result.clearedLocalState = true;
  } catch (error: any) {
    result.failures.push({ resource: "local_state", message: errorMessage(error) });
  }

  result.complete = result.failures.length === 0;
  return result;
}

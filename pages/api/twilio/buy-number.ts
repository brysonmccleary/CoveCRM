// /pages/api/twilio/buy-number.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

// $/mo price for a phone number (platform-billed users)
const PHONE_PRICE_ID =
  process.env.STRIPE_PHONE_PRICE_ID || "price_1RpvR9DF9aEsjVyJk9GiJkpe";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
const INBOUND_SMS_WEBHOOK = `${BASE_URL}/api/twilio/inbound-sms`;
const STATUS_CALLBACK = `${BASE_URL}/api/twilio/status-callback`;
// ✅ point voice to inbound-banner webhook
const VOICE_URL = `${BASE_URL}/api/twilio/voice/inbound`;

/** Normalize to E.164 (+1XXXXXXXXXX) */
function normalizeE164(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

/** Utility to mask SIDs in logs (ACxxxx... or MGxxxx... etc.) */
function maskSid(sid?: string): string | null {
  if (!sid) return null;
  if (sid.length <= 6) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

/**
 * Ensure a tenant Messaging Service exists in the *current* Twilio account
 * (platform or personal, depending on getClientForUser).
 *
 * IMPORTANT:
 * - We ONLY look for / create services via the **passed-in client**, so we
 *   can never accidentally reuse an MG SID from a different Twilio account.
 * - We STILL mirror the SID into A2PProfile + User.a2p for convenience,
 *   but we do not trust those fields to decide which Twilio account to call.
 */
async function ensureTenantMessagingServiceInThisAccount(
  client: any,
  userId: string,
  friendlyNameHint?: string,
) {
  const userDoc = await User.findById(userId);
  const a2p = await A2PProfile.findOne({ userId });

  const friendlyName = `CoveCRM – ${friendlyNameHint || userId}`;

  // 1) Try to find an existing service in THIS account by friendlyName
  let existingService = null as any;
  try {
    const services = await client.messaging.v1.services.list({ limit: 50 });
    existingService = services.find((svc: any) => svc.friendlyName === friendlyName) || null;
  } catch (err) {
    // If listing fails for some reason, we'll just create a new one below.
    console.warn("ensureTenantMessagingServiceInThisAccount: failed to list services", err);
  }

  // 2) If found, make sure webhooks are correct and use it
  if (existingService) {
    await client.messaging.v1.services(existingService.sid).update({
      friendlyName,
      inboundRequestUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    });

    // Mirror onto A2PProfile/User for reference (does NOT affect which account we use)
    if (a2p) {
      a2p.messagingServiceSid = existingService.sid;
      await a2p.save();
    }
    if (userDoc) {
      userDoc.a2p = userDoc.a2p || ({} as any);
      (userDoc.a2p as any).messagingServiceSid = existingService.sid;
      await userDoc.save();
    }

    return existingService.sid;
  }

  // 3) Otherwise, create a new per-tenant service in the *current* Twilio account
  const svc = await client.messaging.v1.services.create({
    friendlyName,
    inboundRequestUrl: INBOUND_SMS_WEBHOOK,
    statusCallback: STATUS_CALLBACK,
  });

  // Update if present; do NOT create a new A2PProfile (your schema requires many fields)
  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  }

  // Mirror on User for quick lookups
  if (userDoc) {
    userDoc.a2p = userDoc.a2p || ({} as any);
    (userDoc.a2p as any).messagingServiceSid = svc.sid;
    await userDoc.save();
  }

  return svc.sid;
}

/** Add a number to a Messaging Service sender pool. Handles 21710 + 21712 safely. */
async function addNumberToMessagingService(
  client: any,
  serviceSid: string,
  numberSid: string,
) {
  try {
    await client.messaging.v1.services(serviceSid).phoneNumbers.create({
      phoneNumberSid: numberSid,
    });
  } catch (err: any) {
    // 21710: Phone Number or Short Code is already in the Messaging Service.
    // Safe to ignore – it's already attached where we want it.
    if (err?.code === 21710) {
      return;
    }

    // 21712: number is already linked to a different service in THIS account
    if (err?.code === 21712) {
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try {
          await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
        } catch {
          // ignore if not linked
        }
      }
      await client.messaging.v1.services(serviceSid).phoneNumbers.create({
        phoneNumberSid: numberSid,
      });
    } else {
      // NOTE: If this is a 20404 here, it means the serviceSid truly does not
      // exist in THIS account. With the new ensureTenantMessagingService logic
      // above, that should no longer happen for normal flows.
      throw err;
    }
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const email = session.user.email.toLowerCase();
  const {
    number,
    areaCode, // may be string from client
    attachToMessagingServiceSid, // optional override for where to attach the number
  } = (req.body || {}) as {
    number?: string;
    areaCode?: string | number;
    attachToMessagingServiceSid?: string;
  };

  if (!number && !areaCode)
    return res.status(400).json({ message: "Provide 'number' or 'areaCode'" });

  let createdSubscriptionId: string | undefined;
  let purchasedSid: string | undefined;

  try {
    await dbConnect();

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const { client, accountSid: activeAccountSid, usingPersonal } =
      await getClientForUser(email);

    console.log(
      JSON.stringify({
        msg: "buy-number: resolved client",
        email,
        usingPersonal,
        userBillingMode: user?.billingMode ?? null,
        activeAccountSidMasked: maskSid(activeAccountSid),
      }),
    );

    // Resolve requested E.164 (or we'll search by area code)
    const requestedNumber = number ? normalizeE164(number) : undefined;

    // Idempotency: prevent dup purchase
    if (requestedNumber && user.numbers?.some((n: any) => n.phoneNumber === requestedNumber)) {
      return res.status(409).json({ message: "You already own this phone number." });
    }
    if (requestedNumber) {
      const existingPhoneDoc = await PhoneNumber.findOne({
        userId: user._id,
        phoneNumber: requestedNumber,
      });
      if (existingPhoneDoc) {
        return res.status(409).json({ message: "You already own this phone number (db)." });
      }
    }

    // ---------- Billing: Platform users must have a payment method & subscription; personal/self users skip Stripe
    const isSelfBilled = usingPersonal || (user as any).billingMode === "self";

    if (!isSelfBilled) {
      if (!user.stripeCustomerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.name || undefined,
        });
        user.stripeCustomerId = customer.id;
        await user.save();
      }

      const customer =
        (await stripe.customers.retrieve(
          user.stripeCustomerId,
        )) as Stripe.Customer | Stripe.DeletedCustomer;

      const hasDefaultPM =
        "deleted" in customer
          ? false
          : Boolean(
              customer.invoice_settings?.default_payment_method ||
                (customer as Stripe.Customer).default_source,
            );

      if (!hasDefaultPM) {
        console.warn(
          JSON.stringify({
            msg: "buy-number: blocking purchase due to missing payment method",
            email,
            usingPersonal,
            userBillingMode: user?.billingMode ?? null,
            stripeCustomerId: user.stripeCustomerId,
          }),
        );
        return res.status(402).json({
          code: "no_payment_method",
          message:
            "Please add a payment method to your account before purchasing a phone number.",
          stripeCustomerId: user.stripeCustomerId,
        });
      }

      // Create $/mo subscription for the number (platform-billed only)
      const subscription = await stripe.subscriptions.create({
        customer: user.stripeCustomerId,
        items: [{ price: PHONE_PRICE_ID }],
        metadata: {
          phoneNumber: requestedNumber || `areaCode:${areaCode ?? ""}`,
          userEmail: user.email,
        },
      });
      if (!subscription?.id) throw new Error("Stripe subscription failed");
      createdSubscriptionId = subscription.id;
    }

    // ---------- Buy number from the resolved Twilio account
    let purchased;
    if (requestedNumber) {
      purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: requestedNumber,
        smsUrl: INBOUND_SMS_WEBHOOK, // fine even if you attach to a Messaging Service
        voiceUrl: VOICE_URL,
        voiceMethod: "POST", // explicit
      });
    } else {
      const areaCodeNum =
        typeof areaCode === "number"
          ? areaCode
          : typeof areaCode === "string"
          ? parseInt(areaCode, 10)
          : undefined;

      if (!areaCodeNum || Number.isNaN(areaCodeNum) || String(areaCodeNum).length !== 3) {
        return res.status(400).json({ message: "Invalid areaCode (must be a 3-digit number)" });
      }

      const available = await client
        .availablePhoneNumbers("US")
        .local.list({
          areaCode: areaCodeNum,
          smsEnabled: true,
          voiceEnabled: true,
          limit: 1,
        });

      if (!available.length)
        return res.status(400).json({ message: "No numbers available for that area code" });

      purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: available[0].phoneNumber!,
        smsUrl: INBOUND_SMS_WEBHOOK,
        voiceUrl: VOICE_URL,
        voiceMethod: "POST",
      });
    }
    purchasedSid = purchased.sid;

    // ---------- Resolve target Messaging Service in the *current* Twilio account
    let targetMS: string;

    if (attachToMessagingServiceSid) {
      // If frontend explicitly passes a serviceSid, only use it if it exists
      try {
        const svc = await client.messaging.v1.services(attachToMessagingServiceSid).fetch();
        targetMS = svc.sid;
      } catch (err: any) {
        if (err?.code === 20404) {
          console.warn(
            "attachToMessagingServiceSid not present in active Twilio account; creating tenant MS instead",
            { attachToMessagingServiceSid },
          );
          targetMS = await ensureTenantMessagingServiceInThisAccount(
            client,
            String(user._id),
            user.name || user.email,
          );
        } else {
          throw err;
        }
      }
    } else {
      // Always ensure a per-tenant Messaging Service in THIS account
      targetMS = await ensureTenantMessagingServiceInThisAccount(
        client,
        String(user._id),
        user.name || user.email,
      );
    }

    // Attach purchased number to the Messaging Service (idempotent; handles 21710 + 21712)
    await addNumberToMessagingService(client, targetMS, purchased.sid);

    // ---------- Save on user doc
    user.numbers = user.numbers || [];
    user.numbers.push({
      sid: purchased.sid,
      phoneNumber: purchased.phoneNumber!,
      subscriptionId: createdSubscriptionId,
      purchasedAt: new Date(),
      messagingServiceSid: targetMS,
      friendlyName: purchased.friendlyName || purchased.phoneNumber!,
      status: "active",
      capabilities: {
        voice: purchased.capabilities?.voice,
        sms: (purchased as any).capabilities?.SMS ?? purchased.capabilities?.sms,
        mms: (purchased as any).capabilities?.MMS ?? purchased.capabilities?.mms,
      },
    } as any);
    // mirror target MS on User.a2p if present
    user.a2p = user.a2p || ({} as any);
    (user.a2p as any).messagingServiceSid = targetMS;
    await user.save();

    // ---------- Persist to PhoneNumber collection
    const a2pLegacy = await A2PProfile.findOne({ userId: user._id }).lean();
    await PhoneNumber.updateOne(
      { phoneNumber: purchased.phoneNumber! },
      {
        $set: {
          userId: user._id,
          phoneNumber: purchased.phoneNumber!,
          messagingServiceSid: targetMS || null,
          profileSid: a2pLegacy?.profileSid,
          a2pApproved: Boolean((user as any).a2p?.messagingReady || a2pLegacy?.messagingReady),
          datePurchased: new Date(),
          twilioSid: purchased.sid,
          friendlyName: purchased.friendlyName || undefined,
        },
      },
      { upsert: true },
    );

    return res.status(200).json({
      ok: true,
      message: "Number purchased and added to your messaging service.",
      number: purchased.phoneNumber,
      sid: purchased.sid,
      subscriptionId: createdSubscriptionId || null,
      messagingServiceSid: targetMS,
      usingPersonal,
      activeAccountSid: activeAccountSid,
    });
  } catch (err: any) {
    console.error("Buy number error:", err);

    // Best-effort rollback in the same account used for purchase
    try {
      if (purchasedSid) {
        const { client } = await getClientForUser(session!.user!.email!);
        await client.incomingPhoneNumbers(purchasedSid).remove();
      }
    } catch {}
    try {
      if (createdSubscriptionId) await stripe.subscriptions.cancel(createdSubscriptionId);
    } catch {}

    const msg =
      err?.message ||
      (typeof err === "string" ? err : "Failed to purchase number");
    return res.status(500).json({ message: msg });
  }
}

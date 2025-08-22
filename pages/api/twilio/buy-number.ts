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
const VOICE_URL = `${BASE_URL}/api/twilio/voice-answer`;

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

/** Add a number to a Messaging Service sender pool. Handles 21712 (unlink/reattach) within the SAME Twilio account. */
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
    if (err?.code === 21712) {
      // number is already linked to a different service in THIS account → unlink everywhere then reattach
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
      throw err;
    }
  }
}

/** Ensure a tenant Messaging Service exists in the *current* client account (platform account). */
async function ensureTenantMessagingServiceInThisAccount(
  client: any,
  userId: string,
  friendlyNameHint?: string,
) {
  let a2p = await A2PProfile.findOne({ userId });

  if (a2p?.messagingServiceSid) {
    // keep hooks fresh
    await client.messaging.v1.services(a2p.messagingServiceSid).update({
      friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
      inboundRequestUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    });
    return a2p.messagingServiceSid;
  }

  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
    inboundRequestUrl: INBOUND_SMS_WEBHOOK,
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

    // IMPORTANT: the resolver now returns { client, accountSid, usingPersonal, user }
    const { client, accountSid: activeAccountSid, usingPersonal } = await getClientForUser(email);

    console.log(
      JSON.stringify({
        msg: "buy-number: resolved client",
        email,
        usingPersonal,
        userBillingMode: user?.billingMode ?? null,
        activeAccountSidMasked: maskSid(activeAccountSid),
      })
    );

    // If a specific number is provided, normalize. Else we’ll search one from areaCode.
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
          })
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
      });
    } else {
      // Parse areaCode to number to satisfy Twilio types
      const areaCodeNum =
        typeof areaCode === "number"
          ? areaCode
          : typeof areaCode === "string"
          ? parseInt(areaCode, 10)
          : undefined;

      if (!areaCodeNum || Number.isNaN(areaCodeNum)) {
        return res.status(400).json({ message: "Invalid areaCode (must be a 3-digit number)" });
      }

      const available = await client
        .availablePhoneNumbers("US")
        .local.list({
          areaCode: areaCodeNum, // <-- number type required by Twilio types
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
      });
    }
    purchasedSid = purchased.sid;

    // ---------- Decide which Messaging Service to attach to (optional)
    // Priority:
    // 1) explicit attachToMessagingServiceSid (body)
    // 2) user-level linked MS (user.a2p.messagingServiceSid)
    // 3) platform users only: ensure/create tenant MS in platform account
    // 4) otherwise skip (user can link later)
    let targetMS: string | undefined =
      attachToMessagingServiceSid ||
      (user as any).a2p?.messagingServiceSid ||
      undefined;

    if (!targetMS && !isSelfBilled) {
      // On platform path we can create/ensure a tenant MS in *this* account
      targetMS = await ensureTenantMessagingServiceInThisAccount(
        client,
        String(user._id),
        user.name || user.email,
      );
    }

    if (targetMS) {
      await addNumberToMessagingService(client, targetMS, purchased.sid);
    }

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
        sms: purchased.capabilities?.sms,
        mms: purchased.capabilities?.mms,
      },
    } as any);
    await user.save();

    // ---------- Persist to PhoneNumber collection
    const a2pLegacy = await A2PProfile.findOne({ userId: user._id }).lean();
    await PhoneNumber.create({
      userId: user._id,
      phoneNumber: purchased.phoneNumber!,
      messagingServiceSid: targetMS || null,
      profileSid: a2pLegacy?.profileSid,
      a2pApproved: Boolean((user as any).a2p?.messagingReady || a2pLegacy?.messagingReady),
      datePurchased: new Date(),
      twilioSid: purchased.sid,
    });

    return res.status(200).json({
      ok: true,
      message: targetMS
        ? "Number purchased and added to your messaging service."
        : isSelfBilled
        ? "Number purchased. Link your A2P Messaging Service to enable texting; calls work now."
        : "Number purchased. Start A2P registration to enable texting; calls work now.",
      number: purchased.phoneNumber,
      sid: purchased.sid,
      subscriptionId: createdSubscriptionId || null,
      messagingServiceSid: targetMS || null,
      usingPersonal,
      activeAccountSid: activeAccountSid,
    });
  } catch (err: any) {
    console.error("Buy number error:", err);

    // Best-effort rollback in the same account used for purchase
    try {
      if (purchasedSid) {
        const { client } = await getClientForUser(email);
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

import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import twilioClient from "@/lib/twilioClient";

// $/mo price for a phone number (env is better, but keeping your constant)
const PHONE_PRICE_ID = "price_1RpvR9DF9aEsjVyJk9GiJkpe";

const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";

/** Normalize to E.164 (+1XXXXXXXXXX) */
function normalizeE164(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

/** Ensure tenant Messaging Service exists & has webhooks. Returns SID. */
async function ensureTenantMessagingService(
  userId: string,
  friendlyNameHint?: string,
) {
  let a2p = await A2PProfile.findOne({ userId });

  if (a2p?.messagingServiceSid) {
    await twilioClient.messaging.v1.services(a2p.messagingServiceSid).update({
      friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
      inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
    });
    return a2p.messagingServiceSid;
  }

  const svc = await twilioClient.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: `${BASE_URL}/api/twilio/status-callback`,
  });

  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  } else {
    await A2PProfile.create({ userId, messagingServiceSid: svc.sid });
  }

  return svc.sid;
}

/** Add a number to a Messaging Service sender pool. Handles 21712 (unlink/reattach). */
async function addNumberToMessagingService(
  serviceSid: string,
  numberSid: string,
) {
  try {
    await twilioClient.messaging.v1.services(serviceSid).phoneNumbers.create({
      phoneNumberSid: numberSid,
    });
  } catch (err: any) {
    if (err?.code === 21712) {
      const services = await twilioClient.messaging.v1.services.list({
        limit: 100,
      });
      for (const svc of services) {
        try {
          await twilioClient.messaging.v1
            .services(svc.sid)
            .phoneNumbers(numberSid)
            .remove();
        } catch {
          // ignore if not linked
        }
      }
      await twilioClient.messaging.v1.services(serviceSid).phoneNumbers.create({
        phoneNumberSid: numberSid,
      });
    } else {
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

  const { number } = req.body as { number?: string };
  if (!number) return res.status(400).json({ message: "Missing phone number" });

  const requestedNumber = normalizeE164(number);

  let createdSubscriptionId: string | undefined;
  let purchasedSid: string | undefined;

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const a2p = await A2PProfile.findOne({ userId: user._id }); // may be undefined if they haven't started A2P

    // Idempotency: prevent dup purchase
    if (user.numbers?.some((n: any) => n.phoneNumber === requestedNumber)) {
      return res
        .status(409)
        .json({ message: "You already own this phone number." });
    }
    const existingPhoneDoc = await PhoneNumber.findOne({
      userId: user._id,
      phoneNumber: requestedNumber,
    });
    if (existingPhoneDoc) {
      return res
        .status(409)
        .json({ message: "You already own this phone number (db)." });
    }

    // Ensure Stripe customer & default payment method
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
      return res.status(402).json({
        code: "no_payment_method",
        message:
          "Please add a payment method to your account before purchasing a phone number.",
        stripeCustomerId: user.stripeCustomerId,
      });
    }

    // Create $/mo subscription
    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: PHONE_PRICE_ID }],
      metadata: { phoneNumber: requestedNumber, userEmail: user.email },
    });
    if (!subscription?.id) throw new Error("Stripe subscription failed");
    createdSubscriptionId = subscription.id;

    // Buy number
    const purchased = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: requestedNumber,
      // number-level webhooks not needed when using messaging service webhooks
    });
    purchasedSid = purchased.sid;

    // If the user already has a tenant Messaging Service (e.g., they started A2P),
    // attach the number now. Otherwise skip (we’ll attach later on A2P approval).
    let messagingServiceSid: string | undefined;
    if (a2p?.messagingServiceSid) {
      messagingServiceSid = a2p.messagingServiceSid;
      // keep hooks fresh
      await twilioClient.messaging.v1.services(messagingServiceSid).update({
        inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
        statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      });
      await addNumberToMessagingService(messagingServiceSid, purchased.sid);
    } else {
      // no-op, will attach when A2P is completed
    }

    // Save on user doc
    user.numbers = user.numbers || [];
    user.numbers.push({
      sid: purchased.sid,
      phoneNumber: purchased.phoneNumber,
      subscriptionId: subscription.id,
      usage: {
        callsMade: 0,
        callsReceived: 0,
        textsSent: 0,
        textsReceived: 0,
        cost: 0,
      },
    });
    await user.save();

    // Persist ownership
    await PhoneNumber.create({
      userId: user._id,
      phoneNumber: purchased.phoneNumber,
      messagingServiceSid, // may be undefined until A2P started → backfill later
      profileSid: a2p?.profileSid,
      a2pApproved: Boolean(a2p?.messagingReady),
      datePurchased: new Date(),
      twilioSid: purchased.sid,
    });

    return res.status(200).json({
      message: messagingServiceSid
        ? "Number purchased and added to your messaging service."
        : "Number purchased. Start A2P registration to enable texting; calls work now.",
      number: purchased.phoneNumber,
      sid: purchased.sid,
      subscriptionId: subscription.id,
      messagingServiceSid: messagingServiceSid || null,
    });
  } catch (err: any) {
    console.error("Buy number error:", err);

    // Best-effort rollback
    try {
      if (purchasedSid)
        await twilioClient.incomingPhoneNumbers(purchasedSid).remove();
    } catch {}
    try {
      if (createdSubscriptionId)
        await stripe.subscriptions.cancel(createdSubscriptionId);
    } catch {}

    const msg =
      err?.message ||
      (typeof err === "string" ? err : "Failed to purchase number");
    return res.status(500).json({ message: msg });
  }
}

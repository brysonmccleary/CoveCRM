// pages/api/mobile/numbers/buy.ts
import type { NextApiRequest, NextApiResponse } from "next";
import type Stripe from "stripe";
import jwt from "jsonwebtoken";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const PHONE_PRICE_ID =
  process.env.STRIPE_PHONE_PRICE_ID || "price_1RpvR9DF9aEsjVyJk9GiJkpe";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");
const INBOUND_SMS_WEBHOOK = `${BASE_URL}/api/twilio/inbound-sms`;
const STATUS_CALLBACK = `${BASE_URL}/api/twilio/status-callback`;
const VOICE_URL = `${BASE_URL}/api/twilio/voice/inbound`;

const PLATFORM_ACCOUNT_SID = (process.env.TWILIO_ACCOUNT_SID || "")
  .replace(/[^A-Za-z0-9]/g, "")
  .trim();

const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

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

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const email = (payload?.email || payload?.sub || "").toString().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Ensure a tenant Messaging Service exists in the *current* Twilio account
 * (platform/master only; we will NOT use this for subaccounts anymore).
 */
async function ensureTenantMessagingServiceInThisAccount(
  client: any,
  userId: string,
  activeAccountSid: string,
  friendlyNameHint?: string,
) {
  const userDoc = await User.findById(userId);
  const a2p = await A2PProfile.findOne({ userId });

  const friendlyName = `CoveCRM – ${friendlyNameHint || userId} – ${activeAccountSid}`;

  let existingService: any = null;
  try {
    const services = await client.messaging.v1.services.list({ limit: 50 });
    existingService =
      services.find((svc: any) => svc.friendlyName === friendlyName) || null;
  } catch (err) {
    console.warn(
      "ensureTenantMessagingServiceInThisAccount: failed to list services",
      err,
    );
  }

  if (existingService) {
    await client.messaging.v1.services(existingService.sid).update({
      friendlyName,
      inboundRequestUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    });

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

  const svc = await client.messaging.v1.services.create({
    friendlyName,
    inboundRequestUrl: INBOUND_SMS_WEBHOOK,
    statusCallback: STATUS_CALLBACK,
  });

  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  }

  if (userDoc) {
    userDoc.a2p = userDoc.a2p || ({} as any);
    (userDoc.a2p as any).messagingServiceSid = svc.sid;
    await userDoc.save();
  }

  return svc.sid;
}

/** Add a number to a Messaging Service sender pool (master account only). */
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
    if (err?.code === 21710) return;

    if (err?.code === 21712) {
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try {
          await client
            .messaging.v1.services(svc.sid)
            .phoneNumbers(numberSid)
            .remove();
        } catch {
          /* ignore */
        }
      }
      await client.messaging.v1.services(serviceSid).phoneNumbers.create({
        phoneNumberSid: numberSid,
      });
      return;
    }

    throw err;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const email = getEmailFromAuth(req);
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const {
    number,
    areaCode,
    attachToMessagingServiceSid,
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

    const {
      client,
      accountSid: activeAccountSid,
      usingPersonal,
    } = await getClientForUser(email);

    const isMasterAccount =
      PLATFORM_ACCOUNT_SID &&
      PLATFORM_ACCOUNT_SID.length > 0 &&
      PLATFORM_ACCOUNT_SID === activeAccountSid;

    console.log(
      JSON.stringify({
        msg: "buy-number (mobile): resolved client",
        email,
        usingPersonal,
        userBillingMode: user?.billingMode ?? null,
        activeAccountSidMasked: maskSid(activeAccountSid),
        isMasterAccount,
        platformAccountMasked: maskSid(PLATFORM_ACCOUNT_SID),
      }),
    );

    const requestedNumber = number ? normalizeE164(number) : undefined;

    if (
      requestedNumber &&
      user.numbers?.some((n: any) => n.phoneNumber === requestedNumber)
    ) {
      return res
        .status(409)
        .json({ message: "You already own this phone number." });
    }
    if (requestedNumber) {
      const existingPhoneDoc = await PhoneNumber.findOne({
        userId: user._id,
        phoneNumber: requestedNumber,
      });
      if (existingPhoneDoc) {
        return res
          .status(409)
          .json({ message: "You already own this phone number (db)." });
      }
    }

    const isSelfBilled =
      usingPersonal || (user as any).billingMode === "self";

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
            msg: "buy-number (mobile): blocking purchase due to missing payment method",
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
        smsUrl: INBOUND_SMS_WEBHOOK,
        voiceUrl: VOICE_URL,
        voiceMethod: "POST",
      });
    } else {
      const areaCodeNum =
        typeof areaCode === "number"
          ? areaCode
          : typeof areaCode === "string"
          ? parseInt(areaCode, 10)
          : undefined;

      if (
        !areaCodeNum ||
        Number.isNaN(areaCodeNum) ||
        String(areaCodeNum).length !== 3
      ) {
        return res
          .status(400)
          .json({ message: "Invalid areaCode (must be a 3-digit number)" });
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
        return res.status(400).json({
          message: "No numbers available for that area code",
        });

      purchased = await client.incomingPhoneNumbers.create({
        phoneNumber: available[0].phoneNumber!,
        smsUrl: INBOUND_SMS_WEBHOOK,
        voiceUrl: VOICE_URL,
        voiceMethod: "POST",
      });
    }
    purchasedSid = purchased.sid;

    // ---------- Resolve target Messaging Service (MASTER ONLY)
    let targetMS: string | undefined = undefined;

    if (isMasterAccount) {
      const userA2p = (user as any).a2p || {};
      const a2pProfile = await A2PProfile.findOne({
        userId: String(user._id),
      }).lean();

      const hasApprovedMasterA2P =
        userA2p.messagingReady === true &&
        typeof userA2p.messagingServiceSid === "string" &&
        userA2p.messagingServiceSid.length > 0;

      if (hasApprovedMasterA2P) {
        try {
          const svc = await client.messaging.v1
            .services(userA2p.messagingServiceSid)
            .fetch();
          targetMS = svc.sid;
          console.log(
            JSON.stringify({
              msg: "buy-number (mobile): reusing master A2P messagingServiceSid",
              email,
              targetMSMasked: maskSid(targetMS),
            }),
          );
        } catch {
          targetMS = await ensureTenantMessagingServiceInThisAccount(
            client,
            String(user._id),
            activeAccountSid,
            user.name || user.email,
          );
        }
      } else {
        targetMS = await ensureTenantMessagingServiceInThisAccount(
          client,
          String(user._id),
          activeAccountSid,
          user.name || user.email,
        );
      }

      if (targetMS) {
        console.log(
          JSON.stringify({
            msg: "buy-number (mobile): attaching number to MS (master only)",
            email,
            targetMSMasked: maskSid(targetMS),
            activeAccountSidMasked: maskSid(activeAccountSid),
          }),
        );
        await addNumberToMessagingService(client, targetMS, purchased.sid);
      }

      await PhoneNumber.updateOne(
        { phoneNumber: purchased.phoneNumber! },
        {
          $set: {
            userId: user._id,
            phoneNumber: purchased.phoneNumber!,
            messagingServiceSid: targetMS || null,
            profileSid: a2pProfile?.profileSid,
            a2pApproved: Boolean(
              (user as any).a2p?.messagingReady || a2pProfile?.messagingReady,
            ),
            datePurchased: new Date(),
            twilioSid: purchased.sid,
            friendlyName: purchased.friendlyName || undefined,
          },
        },
        { upsert: true },
      );
    } else {
      // SUBACCOUNT: no Messaging Service attach; we rely on direct-from sends.
      await PhoneNumber.updateOne(
        { phoneNumber: purchased.phoneNumber! },
        {
          $set: {
            userId: user._id,
            phoneNumber: purchased.phoneNumber!,
            messagingServiceSid: null,
            a2pApproved: false,
            datePurchased: new Date(),
            twilioSid: purchased.sid,
            friendlyName: purchased.friendlyName || undefined,
          },
        },
        { upsert: true },
      );
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
        sms:
          (purchased as any).capabilities?.SMS ?? purchased.capabilities?.sms,
        mms:
          (purchased as any).capabilities?.MMS ?? purchased.capabilities?.mms,
      },
    } as any);
    user.a2p = user.a2p || ({} as any);
    if (targetMS) (user.a2p as any).messagingServiceSid = targetMS;
    await user.save();

    return res.status(200).json({
      ok: true,
      message: "Number purchased.",
      number: purchased.phoneNumber,
      sid: purchased.sid,
      subscriptionId: createdSubscriptionId || null,
      messagingServiceSid: targetMS || null,
      usingPersonal,
      activeAccountSid: activeAccountSid,
    });
  } catch (err: any) {
    console.error("Buy number (mobile) error:", err);

    try {
      if (purchasedSid && email) {
        const { client } = await getClientForUser(email);
        await client.incomingPhoneNumbers(purchasedSid).remove();
      }
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

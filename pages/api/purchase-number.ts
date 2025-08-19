import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import twilioClient from "@/lib/twilioClient";
import dbConnect from "@/lib/mongooseConnect";
import { stripe } from "@/lib/stripe";
import User from "@/models/User";
import { configureTwilioWebhook } from "@/lib/twilio/configureWebhook";
import type Stripe from "stripe";

const STRIPE_PRICE_ID = "price_1RpvR9DF9aEsjVyJk9GiJkpe"; // $2/month

function normalizeE164(p: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p.startsWith("+") ? p : `+${digits}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { areaCode } = (req.body || {}) as { areaCode?: string | number };
  if (
    areaCode === undefined ||
    areaCode === null ||
    String(areaCode).trim() === ""
  ) {
    return res.status(400).json({ message: "Missing area code" });
  }

  const areaCodeNum = Number(String(areaCode).replace(/\D/g, ""));
  if (!Number.isInteger(areaCodeNum) || areaCodeNum < 200 || areaCodeNum > 999) {
    return res.status(400).json({ message: "Invalid area code" });
  }

  let purchasedSid: string | undefined;
  let createdSubscriptionId: string | undefined;

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Ensure Stripe customer & default PM
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: (user as any).name || undefined,
        metadata: { userId: String((user as any)?._id || "") },
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const custResp = await stripe.customers.retrieve(user.stripeCustomerId);
    if ((custResp as Stripe.DeletedCustomer).deleted) {
      return res.status(402).json({
        code: "no_payment_method",
        message:
          "Please add a payment method to your account before purchasing a phone number.",
        stripeCustomerId: user.stripeCustomerId,
      });
    }
    const customer = custResp as Stripe.Customer;
    const hasDefaultPM =
      Boolean(customer.invoice_settings?.default_payment_method) ||
      Boolean(customer.default_source);

    if (!hasDefaultPM) {
      return res.status(402).json({
        code: "no_payment_method",
        message:
          "Please add a payment method to your account before purchasing a phone number.",
        stripeCustomerId: user.stripeCustomerId,
      });
    }

    // 1) Search for a number in given area code
    const numbers = await twilioClient
      .availablePhoneNumbers("US")
      .local.list({ areaCode: areaCodeNum, limit: 1 });

    if (!numbers.length) {
      return res
        .status(404)
        .json({ message: "No numbers available in this area code" });
    }

    // 2) Buy the number in Twilio
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: numbers[0].phoneNumber,
    });
    purchasedSid = purchasedNumber.sid;

    // 3) Configure inbound webhook (best effort)
    try {
      await configureTwilioWebhook(purchasedNumber.phoneNumber);
    } catch (e) {
      console.warn("configureTwilioWebhook failed:", e);
    }

    // 4) Create $2 subscription for the number
    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: STRIPE_PRICE_ID }],
      metadata: {
        phoneNumber: purchasedNumber.phoneNumber,
        userId: String((user as any)?._id || ""),
      },
    });
    createdSubscriptionId = subscription.id;

    // 5) Save number on user doc
    (user as any).numbers = (user as any).numbers || [];
    (user as any).numbers.push({
      sid: purchasedNumber.sid,
      phoneNumber: normalizeE164(purchasedNumber.phoneNumber),
      usage: {
        callsMade: 0,
        callsReceived: 0,
        textsSent: 0,
        textsReceived: 0,
        cost: 0,
      },
      subscriptionId: subscription.id,
    });
    await user.save();

    return res.status(200).json({
      message: "Number purchased and subscription started!",
      phoneNumber: purchasedNumber.phoneNumber,
      sid: purchasedNumber.sid,
      subscriptionId: subscription.id,
    });
  } catch (error: any) {
    console.error("Error purchasing number:", error);

    // Best-effort rollback
    try {
      if (purchasedSid) {
        await twilioClient.incomingPhoneNumbers(purchasedSid).remove();
      }
    } catch (e) {
      console.warn("Rollback: failed to release purchased number:", e);
    }
    try {
      if (createdSubscriptionId) {
        await stripe.subscriptions.cancel(createdSubscriptionId);
      }
    } catch (e) {
      console.warn("Rollback: failed to cancel created subscription:", e);
    }

    return res.status(500).json({
      message: error?.message || "Failed to purchase number",
    });
  }
}

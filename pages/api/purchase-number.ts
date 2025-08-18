import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import twilioClient from "@/lib/twilioClient";
import dbConnect from "@/lib/mongooseConnect";
import stripe from "@/lib/stripe";
import User from "@/models/User";
import { configureTwilioWebhook } from "@/lib/twilio/configureWebhook";

const STRIPE_PRICE_ID = "price_1RpvR9DF9aEsjVyJk9GiJkpe"; // $2/month

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

  const { areaCode } = req.body;
  if (!areaCode) {
    return res.status(400).json({ message: "Missing area code" });
  }

  try {
    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user || !user.stripeCustomerId) {
      return res
        .status(404)
        .json({ message: "User or Stripe customer not found" });
    }

    // 1. Search for number
    const numbers = await twilioClient.availablePhoneNumbers("US").local.list({
      areaCode,
      limit: 1,
    });

    if (numbers.length === 0) {
      return res
        .status(404)
        .json({ message: "No numbers available in this area code" });
    }

    // 2. Purchase the number
    const purchasedNumber = await twilioClient.incomingPhoneNumbers.create({
      phoneNumber: numbers[0].phoneNumber,
    });

    // ✅ 3. Set up webhook for inbound calls
    await configureTwilioWebhook(purchasedNumber.phoneNumber);

    // 4. Create $2 subscription for the number
    const subscription = await stripe.subscriptions.create({
      customer: user.stripeCustomerId,
      items: [{ price: STRIPE_PRICE_ID }],
      metadata: {
        phoneNumber: purchasedNumber.phoneNumber,
        userId: user._id.toString(),
      },
    });

    // 5. Track number in DB
    user.numbers.push({
      sid: purchasedNumber.sid,
      phoneNumber: purchasedNumber.phoneNumber,
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

    res.status(200).json({
      message: "Number purchased and subscription started!",
      phoneNumber: purchasedNumber.phoneNumber,
    });
  } catch (error) {
    console.error("Error purchasing number:", error);
    res.status(500).json({ message: "Failed to purchase number" });
  }
}

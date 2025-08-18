import type { NextApiRequest, NextApiResponse } from "next";
import { getUserByPhoneNumber } from "@/lib/getUserByPhoneNumber";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const SMS_COST = 0.03;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const { To, From, Body } = req.body;

  if (!To || !From || !Body) {
    return res.status(400).json({ message: "Missing SMS parameters" });
  }

  try {
    await dbConnect();

    const user = await getUserByPhoneNumber(To);
    if (!user) {
      return res
        .status(404)
        .json({ message: "User not found for number: " + To });
    }

    // ✅ Find matching number entry
    const numberEntry = user.numbers?.find((n) => n.phoneNumber === To);
    if (!numberEntry) {
      return res.status(404).json({ message: "Number not registered to user" });
    }

    // ✅ Update usage tracking for this number
    if (!numberEntry.usage) {
      numberEntry.usage = {
        callsMade: 0,
        callsReceived: 0,
        textsSent: 0,
        textsReceived: 1,
        cost: SMS_COST,
      };
    } else {
      numberEntry.usage.textsReceived += 1;
      numberEntry.usage.cost += SMS_COST;
    }

    // ✅ Update user-level Twilio + total cost
    user.aiUsage = user.aiUsage || {
      openAiCost: 0,
      twilioCost: 0,
      totalCost: 0,
    };
    user.aiUsage.twilioCost += SMS_COST;
    user.aiUsage.totalCost += SMS_COST;

    // ✅ Deduct from usage balance
    user.usageBalance = (user.usageBalance || 0) - SMS_COST;

    await user.save();

    // ✅ Twilio XML response
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(`
      <Response>
        <Message>Thanks for your message!</Message>
      </Response>
    `);
  } catch (error) {
    console.error("Error in receive-sms:", error);
    res.status(500).end("Internal Server Error");
  }
}

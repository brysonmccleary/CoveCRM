// /pages/api/twilio/make-call.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilioClient from "@/lib/twilioClient";
import dbConnect from "@/lib/mongooseConnect";
import { getUserByEmail } from "@/models/User";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import { trackUsage } from "@/lib/billing/trackUsage";

const ESTIMATED_MINUTES = 1;
const CALL_COST_PER_MIN = 0.02;

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

  const { toNumber, fromNumber } = req.body || {};
  if (!toNumber || !fromNumber) {
    return res.status(400).json({ message: "Missing parameters" });
  }

  try {
    await dbConnect();
    const user = await getUserByEmail(session.user.email);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ❌ Block if user is frozen for unpaid usage
    const usageBalance = Number((user as any).usageBalance ?? 0);
    if (usageBalance < -20) {
      return res
        .status(403)
        .json({ message: "Usage balance too low. Please update payment." });
    }

    const estimatedCost = CALL_COST_PER_MIN * ESTIMATED_MINUTES;

    const numbers = ((user as any).numbers || []) as Array<{
      phoneNumber: string;
      usage?: {
        callsMade: number;
        callsReceived: number;
        textsSent: number;
        textsReceived: number;
        cost: number;
      };
    }>;

    const numberEntry = numbers.find((n) => n.phoneNumber === fromNumber);
    if (!numberEntry) {
      return res
        .status(404)
        .json({ message: "Caller number not found on user account" });
    }

    if (!numberEntry.usage) {
      numberEntry.usage = {
        callsMade: 1,
        callsReceived: 0,
        textsSent: 0,
        textsReceived: 0,
        cost: estimatedCost,
      };
    } else {
      numberEntry.usage.callsMade += 1;
      numberEntry.usage.cost += estimatedCost;
    }

    // ✅ Deduct usage immediately
    await trackUsage({
      user,
      amount: estimatedCost,
      source: "twilio",
    });

    const call = await twilioClient.calls.create({
      to: toNumber,
      from: fromNumber,
      url: `${process.env.NEXT_PUBLIC_BASE_URL}/api/twilio/voice-response`,
      statusCallback: `${process.env.NEXT_PUBLIC_BASE_URL}/api/twilio/status-callback`,
      statusCallbackEvent: ["completed"],
      statusCallbackMethod: "POST",
    });

    return res.status(200).json({ message: "Call initiated", call });
  } catch (error) {
    console.error("Error making call:", error);
    return res.status(500).json({ message: "Failed to initiate call" });
  }
}

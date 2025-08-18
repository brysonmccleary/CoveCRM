// /pages/api/twilio/inbound-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import User from "@/models/User";

// ✅ Disable body parsing so Twilio webhook can send x-www-form-urlencoded
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    const rawBody = await buffer(req);
    const bodyString = rawBody.toString("utf8");
    const params = new URLSearchParams(bodyString);

    const fromNumber = params.get("From");
    const toNumber = params.get("To");
    const messageBody = params.get("Body") || ""; // Not needed for banner, but useful for future logging

    if (!fromNumber || !toNumber) {
      console.warn("⚠️ Missing From or To in inbound callback");
      return res.status(200).end(); // Acknowledge Twilio to prevent retries
    }

    await dbConnect();

    // ✅ 1. Find the user that owns this Twilio number (To)
    const user = await User.findOne({ "numbers.phoneNumber": toNumber });

    if (!user) {
      console.warn(`⚠️ No user found for number ${toNumber}`);
      return res.status(200).end(); // Still return 200 to Twilio
    }

    // ✅ 2. Find the lead calling in (From) under this user
    const lead = await Lead.findOne({
      Phone: fromNumber,
      userEmail: user.email,
    });

    if (!lead) {
      console.warn(
        `⚠️ No matching lead found for inbound number ${fromNumber}`,
      );
      return res.status(200).end(); // Still acknowledge Twilio
    }

    // ✅ 3. Mark lead as inbound callback for the banner system
    lead.isInboundCallback = true;
    lead.callbackNotified = false;
    await lead.save();

    console.log(
      `📞 Inbound call from ${fromNumber} flagged for user ${user.email}`,
    );
    return res.status(200).end();
  } catch (err) {
    console.error("❌ Error in inbound callback handler:", err);
    return res.status(500).end("Server error");
  }
}

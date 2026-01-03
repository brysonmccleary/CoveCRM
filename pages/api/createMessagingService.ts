// pages/api/createMessagingService.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User"; // optional, if you want to use their name
import { getPlatformTwilioClient } from "@/lib/twilio/getPlatformClient";

const client = getPlatformTwilioClient();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id)
    return res.status(401).json({ message: "Unauthorized" });

  await dbConnect();

  try {
    const a2p = await A2PProfile.findOne({ userId: session.user.id });
    if (!a2p || !a2p.profileSid) {
      return res
        .status(400)
        .json({ message: "No A2P profile found for this user." });
    }

    const user = await User.findById(session.user.id);
    const friendlyName = `CoveCRM - ${user?.name || "User"}`;

    // ✅ Create Twilio Messaging Service
    const service = await client.messaging.services.create({
      friendlyName,
      useInboundWebhookOnNumber: true,
      statusCallback: `${process.env.NEXT_PUBLIC_BASE_URL}/api/twilio/status`, // optional
    });

    // You can store this in a PhoneNumber model, or update A2PProfile with it:
    a2p.messagingServiceSid = service.sid;
    await a2p.save();

    return res.status(200).json({
      success: true,
      messagingServiceSid: service.sid,
      friendlyName: service.friendlyName,
    });
  } catch (err: any) {
    console.error("Messaging service error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
}

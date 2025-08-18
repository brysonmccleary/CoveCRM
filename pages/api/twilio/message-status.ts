// pages/api/twilio/message-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID!;
const authToken = process.env.TWILIO_AUTH_TOKEN!;
const client = twilio(accountSid, authToken);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  const sid = req.query.sid as string | undefined;
  if (!sid) return res.status(400).json({ message: "Missing sid query param" });

  try {
    const msg = await client.messages(sid).fetch();
    return res.status(200).json({
      sid: msg.sid,
      status: msg.status, // queued, sent, delivered, undelivered, failed
      errorCode: msg.errorCode, // Twilio error code if any
      errorMessage: msg.errorMessage, // human-readable explanation
      to: msg.to,
      from: msg.from,
      dateCreated: msg.dateCreated,
      dateSent: msg.dateSent,
      dateUpdated: msg.dateUpdated,
      numSegments: msg.numSegments,
      direction: msg.direction,
      messagingServiceSid: (msg as any).messagingServiceSid || null,
    });
  } catch (err: any) {
    console.error("Twilio fetch error:", err);
    return res
      .status(500)
      .json({ message: err?.message || "Failed to fetch message" });
  }
}

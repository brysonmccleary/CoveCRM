import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";
import twilio from "twilio";

const client = twilio(process.env.TWILIO_SID!, process.env.TWILIO_AUTH_TOKEN!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { dripId, toNumber, testMessage } = req.body;

  if (!toNumber || !testMessage) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    await client.messages.create({
      body: testMessage,
      from: process.env.TWILIO_FROM_NUMBER!,
      to: toNumber,
    });
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: "Failed to send test SMS" });
  }
}

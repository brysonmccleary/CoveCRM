// /pages/api/twilio/voice/inbound.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

// Required to parse Twilio's form-encoded webhook payload
export const config = {
  api: {
    bodyParser: false,
  },
};

const buffer = require("micro").buffer;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const rawBody = (await buffer(req)).toString("utf8");
  const params = new URLSearchParams(rawBody);

  const from = params.get("From") || "Unknown";
  const to = params.get("To") || "Unknown";

  console.log(`📞 Inbound call from ${from} to ${to}`);

  const response = new TwilioTwiml.VoiceResponse();

  // Example: Say a message then hang up
  response.say("Thanks for calling. Your call has been received.");
  response.hangup();

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(response.toString());
}

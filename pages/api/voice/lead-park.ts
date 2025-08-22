// pages/api/voice/lead-park.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = new twilio.twiml.VoiceResponse();
  // Keep the call alive quietly. AMD (DetectMessageEnd) will notify our amd-callback,
  // which will then redirect this call to play a drop or hang up immediately.
  twiml.pause({ length: 60 });
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

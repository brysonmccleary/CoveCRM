// pages/api/twiml/silence.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

// Returns long silence so Conference waitUrl never plays Twilio music
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const vr = new TwilioTwiml.VoiceResponse();
  // 10 minutes of silence; Twilio will loop waitUrl if needed
  vr.pause({ length: 600 } as any);
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

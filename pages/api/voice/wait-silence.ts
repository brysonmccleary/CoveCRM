import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const vr = new twilio.twiml.VoiceResponse();
  // A long pause = silence while the other party joins
  vr.pause({ length: 60 }); // extend if you like
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

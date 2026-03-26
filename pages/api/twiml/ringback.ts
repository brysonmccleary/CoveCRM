// /pages/api/twiml/ringback.ts
// TwiML: play your ringback mp3 in a loop (used as Conference waitUrl)
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export const config = { api: { bodyParser: false } };

function baseUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
  return raw || "https://www.covecrm.com";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const vr = new twilio.twiml.VoiceResponse();
  const ringUrl = `${baseUrl()}/ringback.mp3`;
  vr.play({ loop: 0 }, ringUrl); // loop=0 => infinite on Twilio

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}

// pages/api/voice/lead-join.ts
// TwiML that connects the LEAD into the conference (silence only while waiting)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const SILENCE_URL = `${BASE_URL}/api/twiml/silence`;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const conferenceName = (req.query.conferenceName as string) || "default";
  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,   // lead starts room (no hold music)
      endConferenceOnExit: true,      // tear down when lead leaves
      beep: false,                    // no beeps
      waitUrl: SILENCE_URL,           // absolute silence (no Twilio music)
      waitMethod: "POST",
    } as any,
    String(conferenceName),
  );
  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

// /pages/api/voice/lead-join.ts
// TwiML that connects the LEAD into the conference immediately (no hold music)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const conferenceName = (req.query.conferenceName as string) || "default";
  const vr = new TwilioTwiml.VoiceResponse();

  const dial = vr.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,  // lead starts the room so there is no “waiting”
      endConferenceOnExit: true,     // tear down when the lead leaves
      beep: "off",                   // no beeps
      waitUrl: "",                   // <— absolute silence while waiting
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

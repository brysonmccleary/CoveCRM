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
      startConferenceOnEnter: true, // lead starts the room (no waiting)
      endConferenceOnExit: true,    // tear down when lead leaves
      beep: false,                  // no beeps
      // If anyone ever "waits", it's still silent:
      waitUrl: "http://twimlets.com/holdmusic?Bucket=com.twilio.music.silent",
      waitMethod: "GET",
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

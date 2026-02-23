// /pages/api/twiml/voice/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Twilio from "twilio";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
const SILENCE_URL = `${BASE_URL}/api/twiml/silence`;

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const conference =
      (typeof req.query.conference === "string" && req.query.conference) ||
      (typeof req.query.conf === "string" && req.query.conf) ||
      "";

    if (!conference) {
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<Response><Say>Missing conference.</Say><Hangup/></Response>`);
    }

    const twiml = new Twilio.twiml.VoiceResponse();
    const dial = twiml.dial({ record: "do-not-record" });

    dial.conference(
      {
        startConferenceOnEnter: true,
        endConferenceOnExit: true,
        beep: false,
        waitUrl: SILENCE_URL,
        waitMethod: "POST",
      } as any,
      String(conference)
    );

    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(twiml.toString());
  } catch {
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(`<Response><Say>Application error.</Say><Hangup/></Response>`);
  }
}

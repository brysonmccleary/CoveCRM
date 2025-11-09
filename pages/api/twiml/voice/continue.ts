// /pages/api/twiml/voice/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Twilio from "twilio";

export const config = {
  api: { bodyParser: false }, // Twilio posts/gets without JSON; we only read query
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
        endConferenceOnExit: true, // ✅ When callee leaves, end the conference
        beep: false,
        // (optional) you can add statusCallback + events here if you want,
        // but not required for the UI fix.
      },
      String(conference)
    );

    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(twiml.toString());
  } catch (e) {
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(`<Response><Say>Application error.</Say><Hangup/></Response>`);
  }
}

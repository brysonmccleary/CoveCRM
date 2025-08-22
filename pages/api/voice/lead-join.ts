// pages/api/voice/lead-join.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { conferenceName } = req.query;
  const twiml = new twilio.twiml.VoiceResponse();

  twiml.dial().conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      // You can also add region/recording here if desired
    },
    String(conferenceName || "default"),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

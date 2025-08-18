import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { conferenceName } = req.query;
  const twiml = new twilio.twiml.VoiceResponse();

  twiml.dial().conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
    },
    conferenceName as string,
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

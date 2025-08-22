// pages/api/voice/agent-join.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // This endpoint is invoked by Twilio when your browser softphone makes an
  // outgoing Client call using your TwiML App (OutgoingApplicationSid).
  // Twilio forwards any params you pass via Device.connect({ params }).
  const { conferenceName } = (req.method === "POST" ? req.body : req.query) as any;

  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial();

  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,   // hangup the whole thing when agent leaves
      beep: false,
    },
    String(conferenceName || "default"),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

// pages/api/voice/agent-join.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import { buffer } from "micro";

export const config = {
  api: { bodyParser: false }, // Twilio posts x-www-form-urlencoded
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Twilio forwards params from Device.connect({ params }) either in the body or query
  let conferenceName = String((req.query?.conferenceName as string) || "");

  if (req.method === "POST") {
    try {
      const raw = await buffer(req);
      const params = new URLSearchParams(raw.toString("utf8"));
      if (!conferenceName) conferenceName = params.get("conferenceName") || "";
    } catch {
      // fall through; we'll default to "default" if not provided
    }
  }

  const twiml = new twilio.twiml.VoiceResponse();
  const dial = twiml.dial();

  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true, // end room when agent leaves
      beep: "false",             // NOTE: must be a string literal per Twilio typings
    },
    String(conferenceName || "default"),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

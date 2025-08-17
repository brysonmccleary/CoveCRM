// /pages/api/twilio/voice-response.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const twiml = new VoiceResponse();

  // Accept To from body or query, keep backward compatibility
  const to = (req.body?.To as string) || (req.query?.To as string);
  const callerId =
    (req.query?.callerId as string) ||
    process.env.TWILIO_CALLER_ID ||
    process.env.TWILIO_NUMBER ||
    "";

  if (to) {
    // Optional: carry the leadId into the recording callback
    const leadId = (req.query?.leadId as string) || "";

    // Record both legs when the callee answers; send status to your recording endpoint
    const recordingCb = `${BASE_URL}/api/twilio-recording${
      leadId ? `?CustomFieldLeadId=${encodeURIComponent(leadId)}` : ""
    }`;

    const dial = twiml.dial({
      callerId,
      record: "record-from-answer-dual",
      recordingStatusCallback: recordingCb,
      recordingStatusCallbackMethod: "POST",
      // Twilio always posts "completed" for this callback type; explicit method is enough
    });

    dial.number(to);
  } else {
    twiml.say("Sorry, no destination number provided.");
  }

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

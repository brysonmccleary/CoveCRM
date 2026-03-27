// pages/api/twilio/voicemail-twiml.ts
// TwiML endpoint for voicemail drops — plays script via TTS when answering machine detected
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import VoicemailDrop from "@/models/VoicemailDrop";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { dropId, event, AnsweredBy } = req.query as Record<string, string>;

  res.setHeader("Content-Type", "text/xml");

  await mongooseConnect();

  const drop = dropId ? await VoicemailDrop.findById(dropId).lean() : null;
  const scriptText = (drop as any)?.scriptText || "Hi, this is a message for you from your insurance agent. Please call back at your earliest convenience. Thank you.";
  const voice = (drop as any)?.ttsVoice || "Polly.Matthew";

  const twiml = new VoiceResponse();

  // If AMD detected machine, play the voicemail
  if (event === "amd") {
    const answered = (AnsweredBy || "").toLowerCase();
    if (answered.includes("machine") || answered.includes("fax")) {
      twiml.pause({ length: 2 });
      twiml.say({ voice }, scriptText);
    } else {
      // Human answered — hang up (they can call back)
      twiml.hangup();
    }
  } else {
    // Initial call — pause briefly, then speak (fallback if AMD not used)
    twiml.pause({ length: 1 });
    twiml.say({ voice }, scriptText);
  }

  return res.send(twiml.toString());
}

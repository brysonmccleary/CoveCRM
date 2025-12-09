// pages/api/ai-calls/voice-twiml.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const streamBase = process.env.AI_VOICE_STREAM_URL;
  if (!streamBase) {
    console.error("AI_VOICE_STREAM_URL is not set");
    res.setHeader("Content-Type", "text/xml");
    return res.status(500).send("<Response></Response>");
  }

  // Twilio needs wss:// for <Stream>, so convert http(s):// → ws(s)://
  const wsUrl = streamBase.replace(/^http/, "ws");

  const twiml = new VoiceResponse();
  const connect = twiml.connect();

  connect.stream({
    url: wsUrl,
    track: "both_tracks", // send both directions to the AI server
  });

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(twiml.toString());
}

// pages/api/ai-calls/voice-twiml.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";

// Base URL for your AI voice WebSocket server (Node WS + OpenAI Realtime)
// Example (dev):  wss://<ngrok-subdomain>.ngrok-free.app/media-stream
// Example (prod): wss://ai-voice.covecrm.com/media-stream
const AI_VOICE_STREAM_URL = (process.env.AI_VOICE_STREAM_URL || "").replace(
  /\/$/,
  ""
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Twilio will POST form-encoded params here, but we also allow GET for debugging.
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Content-Type", "text/xml");
    return res.status(405).send(
      `<Response>
         <Say>Method not allowed.</Say>
         <Hangup/>
       </Response>`
    );
  }

  const twiml = new (twilio as any).twiml.VoiceResponse();

  // Session + lead IDs we attached in the worker URL
  const { sessionId, leadId } = req.query as {
    sessionId?: string;
    leadId?: string;
  };

  // Twilio call metadata (form-encoded body for POST, query fallback if needed)
  const body: any = req.body || {};
  const callSid: string =
    body.CallSid || (req.query.CallSid as string) || "";
  const fromNumber: string =
    body.From || (req.query.From as string) || "";
  const toNumber: string =
    body.To || (req.query.To as string) || "";

  // We *prefer* the logged-in user (for browser-initiated calls),
  // but for AI sessions the worker is server-side, so this is mostly metadata.
  let userEmail: string | undefined;
  try {
    const session = await getServerSession(req, res, authOptions as any);
    if (session?.user?.email) {
      userEmail = String(session.user.email).toLowerCase();
    }
  } catch {
    // It's fine if this fails; Twilio does not rely on it.
  }

  // If the AI voice stream URL is missing, don't break the call,
  // just play a friendly message and hang up.
  if (!AI_VOICE_STREAM_URL) {
    twiml.say(
      "The A I dialer is not fully configured yet. Please contact support."
    );
    twiml.hangup();

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  }

  // Build the streaming connection to your AI voice server.
  //
  // Inside the ai-voice-server, you'll receive these parameters as:
  //   msg.start.customParameters.sessionId
  //   msg.start.customParameters.leadId
  //   msg.start.customParameters.userEmail
  //   msg.start.customParameters.callSid
  //   msg.start.customParameters.from
  //   msg.start.customParameters.to
  const connect = twilioConnect(twiml);
  const stream = connect.stream({
    url: `${AI_VOICE_STREAM_URL}/media-stream`,
  });

  if (sessionId) {
    stream.parameter({
      name: "sessionId",
      value: String(sessionId),
    });
  }

  if (leadId) {
    stream.parameter({
      name: "leadId",
      value: String(leadId),
    });
  }

  if (userEmail) {
    stream.parameter({
      name: "userEmail",
      value: userEmail,
    });
  }

  if (callSid) {
    stream.parameter({
      name: "callSid",
      value: callSid,
    });
  }

  if (fromNumber) {
    stream.parameter({
      name: "from",
      value: fromNumber,
    });
  }

  if (toNumber) {
    stream.parameter({
      name: "to",
      value: toNumber,
    });
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

/**
 * Small helper to create a <Connect> verb.
 * Kept separate in case we ever want to add more <Connect> logic later.
 */
function twilioConnect(twiml: any) {
  // This returns a <Connect> TwiML verb instance
  return twiml.connect();
}

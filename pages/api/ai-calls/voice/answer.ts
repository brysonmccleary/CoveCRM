// pages/api/ai-calls/voice/answer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

// Twilio sends standard form-encoded params, so the default bodyParser is fine.
// We keep bodyParser: false only if you're doing raw signature verification.
// You already had this, so we'll leave it in place.
export const config = { api: { bodyParser: false } };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const twiml = new VoiceResponse();

  const { sessionId, leadId } = req.query as {
    sessionId?: string;
    leadId?: string;
  };

  const streamBase = process.env.AI_VOICE_STREAM_URL;

  if (streamBase) {
    // ───────────────────────────
    // Primary path: Stream audio to AI brain
    // ───────────────────────────

    // Twilio needs ws(s):// for <Stream>, so convert http(s):// → ws(s)://
    const wsUrl = streamBase.replace(/^http/, "ws");

    const connect = twiml.connect();

    const stream = connect.stream({
      url: wsUrl,
      track: "both_tracks", // send both directions to the AI server
    } as any);

    // Attach metadata so the AI orchestrator can look up
    // the full lead + agent context in your DB.
    if (sessionId) {
      stream.parameter({ name: "sessionId", value: String(sessionId) } as any);
    }
    if (leadId) {
      stream.parameter({ name: "leadId", value: String(leadId) } as any);
    }

    // NOTE:
    // - The WebSocket server at AI_VOICE_STREAM_URL will receive Twilio's
    //   audio frames + these parameters and should:
    //   1) Load AICallSession by sessionId, then User + Lead by userEmail/leadId.
    //   2) Inject <client first name>, <agent name>, script, voice profile, etc.
    //   3) Bridge Twilio audio <-> OpenAI Realtime Voice.
    //   4) Call /api/ai-calls/book-appointment + /api/ai-calls/outcome as needed.
  } else {
    // ───────────────────────────
    // Fallback: simple testing message if AI_VOICE_STREAM_URL is not set
    // ───────────────────────────
    twiml.say(
      { voice: "alice" } as any,
      "Hi, this is your automated assistant calling on behalf of your agent. This call flow is in testing mode because the streaming endpoint is not configured."
    );
    twiml.pause({ length: 2 } as any);
    twiml.hangup();
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml.toString());
}

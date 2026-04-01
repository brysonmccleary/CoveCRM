// pages/api/ai-calls/transfer-fallback.ts
// Called by Twilio if the agent doesn't answer on live transfer.
// Plays a graceful message and ends the call.
import type { NextApiRequest, NextApiResponse } from "next";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { key } = req.query as Record<string, string>;

  if (!key || key !== AI_DIALER_CRON_KEY) {
    return res.status(401).send("Unauthorized");
  }

  // TwiML: Apologize and hang up gracefully. The lead will be followed up manually.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" rate="90%">Looks like my agent just stepped into another call. I want to make sure you get taken care of. Someone from our team will follow up with you very shortly. Have a great day.</Say>
  <Hangup/>
</Response>`;

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml);
}

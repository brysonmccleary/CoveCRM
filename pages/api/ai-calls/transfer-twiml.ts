// pages/api/ai-calls/transfer-twiml.ts
// Generates TwiML to dial the agent for a live transfer.
// Called by the voice server via Twilio REST API call redirect.
import type { NextApiRequest, NextApiResponse } from "next";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { agentPhone, leadName, agentName, scope, key } = req.query as Record<string, string>;

  if (!key || key !== AI_DIALER_CRON_KEY) {
    return res.status(401).send("Unauthorized");
  }

  if (!agentPhone) {
    return res.status(400).send("Missing agentPhone");
  }

  // Normalize phone
  const digits = (agentPhone || "").replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.startsWith("1") && digits.length === 11 ? `+${digits}` : agentPhone;

  const fallbackUrl = new URL("/api/ai-calls/transfer-fallback", COVECRM_BASE_URL);
  fallbackUrl.searchParams.set("key", AI_DIALER_CRON_KEY);

  // TwiML: Dial the agent. On no-answer (timeout 25s / 4 rings), redirect to fallback.
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="25" callerId="${process.env.TWILIO_PHONE_NUMBER || ""}" action="${fallbackUrl.toString()}" method="POST">
    <Number statusCallbackEvent="initiated ringing answered completed">${e164}</Number>
  </Dial>
</Response>`;

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml);
}

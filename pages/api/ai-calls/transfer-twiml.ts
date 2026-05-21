// pages/api/ai-calls/transfer-twiml.ts
// Generates TwiML to dial the agent for a live transfer.
// Called by the voice server via Twilio REST API call redirect.
import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function hashPrefix(value: any): string {
  const v = String(value ?? "");
  if (!v) return "";
  return createHash("sha256").update(v).digest("hex").slice(0, 8);
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { agentPhone, leadName, agentName, scope, key, sessionId, leadId, callSid, exactTimeText, startTimeUtc, leadTimeZone, agentTimeZone, userEmail } = req.query as Record<string, string>;

  if (!key || key !== AI_DIALER_CRON_KEY) {
    console.warn("[AI-CALLS][TRANSFER_TWIML_AUTH_FAIL]", {
      hasProvidedKey: !!key,
      providedKeyLength: key ? String(key).length : 0,
      expectedKeyLength: AI_DIALER_CRON_KEY ? AI_DIALER_CRON_KEY.length : 0,
      providedKeyHashPrefix: hashPrefix(key),
      expectedKeyHashPrefix: hashPrefix(AI_DIALER_CRON_KEY),
      queryKeysPresent: Object.keys(req.query || {}).sort(),
    });
    return res.status(401).send("Unauthorized");
  }

  if (!agentPhone) {
    return res.status(400).send("Missing agentPhone");
  }

  // Normalize phone
  const digits = (agentPhone || "").replace(/\D/g, "");
  const e164 = digits.length === 10 ? `+1${digits}` : digits.startsWith("1") && digits.length === 11 ? `+${digits}` : agentPhone;

  const agentFirst = (agentName || "our agent").split(" ")[0] || "our agent";

  const fallbackUrl = new URL("/api/ai-calls/transfer-fallback", COVECRM_BASE_URL);
  fallbackUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
  fallbackUrl.searchParams.set("sessionId", sessionId || "");
  fallbackUrl.searchParams.set("leadId", leadId || "");
  fallbackUrl.searchParams.set("callSid", callSid || "");
  fallbackUrl.searchParams.set("exactTimeText", exactTimeText || "");
  fallbackUrl.searchParams.set("startTimeUtc", startTimeUtc || "");
  fallbackUrl.searchParams.set("leadTimeZone", leadTimeZone || "");
  fallbackUrl.searchParams.set("agentTimeZone", agentTimeZone || "");
  fallbackUrl.searchParams.set("userEmail", userEmail || "");
  fallbackUrl.searchParams.set("agentName", agentName || "");

  // TwiML: Say hold message, then dial the agent. On no-answer (timeout 25s / 4 rings), redirect to fallback.
  const safeAgentFirst = xmlEscape(agentFirst);
  const safeCallerId = process.env.TWILIO_PHONE_NUMBER
    ? ` callerId="${xmlEscape(process.env.TWILIO_PHONE_NUMBER)}"`
    : "";
  const safeFallbackUrl = xmlEscape(fallbackUrl.toString());
  const safeE164 = xmlEscape(e164);

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Please hold for just a moment while I connect you with ${safeAgentFirst}.</Say>
  <Dial timeout="25" answerOnBridge="true"${safeCallerId} action="${safeFallbackUrl}" method="POST">
    <Number statusCallbackEvent="initiated ringing answered completed">${safeE164}</Number>
  </Dial>
</Response>`;

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml);
}

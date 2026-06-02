// pages/api/ai-calls/transfer-twiml.ts
// Two-leg live transfer: keep lead on hold, dial agent separately, bridge only after AMD.
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";
const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function normalizeE164(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 10) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

async function resolveTwilioClient(userEmail: string) {
  if (userEmail) {
    return getClientForUser(userEmail);
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!accountSid || !authToken) {
    throw new Error("Missing Twilio credentials");
  }
  return {
    client: twilio(accountSid, authToken),
    accountSid,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = req.query;
  const agentPhone = getQueryValue(q.agentPhone);
  const leadName = getQueryValue(q.leadName);
  const agentName = getQueryValue(q.agentName);
  const scope = getQueryValue(q.scope);
  const key = getQueryValue(q.key);
  const sessionId = getQueryValue(q.sessionId);
  const leadId = getQueryValue(q.leadId);
  const callSid = getQueryValue(q.callSid);
  const exactTimeText = getQueryValue(q.exactTimeText);
  const startTimeUtc = getQueryValue(q.startTimeUtc);
  const leadTimeZone = getQueryValue(q.leadTimeZone);
  const agentTimeZone = getQueryValue(q.agentTimeZone);
  const userEmail = getQueryValue(q.userEmail).toLowerCase();
  const leadPhone = getQueryValue(q.leadPhone);
  const fromNumberRaw =
    getQueryValue(q.fromNumber) ||
    process.env.TWILIO_PHONE_NUMBER ||
    process.env.TWILIO_FROM_NUMBER ||
    process.env.FROM_NUMBER ||
    "";

  if (!key || !AI_DIALER_CRON_KEY || key !== AI_DIALER_CRON_KEY) {
    console.warn("[AI-CALLS][TRANSFER_TWIML_AUTH_FAIL]", {
      hasProvidedKey: !!key,
      providedKeyLength: key ? String(key).length : 0,
      expectedKeyLength: AI_DIALER_CRON_KEY ? AI_DIALER_CRON_KEY.length : 0,
    });
    return res.status(401).send("Unauthorized");
  }

  if (!agentPhone) {
    return res.status(400).send("Missing agentPhone");
  }

  if (!callSid) {
    return res.status(400).send("Missing callSid");
  }

  const agentTo = normalizeE164(agentPhone);
  const conferenceName = `conf_${callSid}_${Date.now()}`;

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
  fallbackUrl.searchParams.set("leadName", leadName || "");
  fallbackUrl.searchParams.set("scope", scope || "");

  const bridgeUrl = new URL("/api/ai-calls/agent-bridge-twiml", COVECRM_BASE_URL);
  const amdCallbackUrl = new URL("/api/ai-calls/agent-amd-callback", COVECRM_BASE_URL);
  for (const url of [bridgeUrl, amdCallbackUrl]) {
    url.searchParams.set("key", AI_DIALER_CRON_KEY);
    url.searchParams.set("conferenceName", conferenceName);
    url.searchParams.set("leadCallSid", callSid);
    url.searchParams.set("sessionId", sessionId || "");
    url.searchParams.set("leadId", leadId || "");
    url.searchParams.set("agentPhone", agentPhone || "");
    url.searchParams.set("userEmail", userEmail || "");
    url.searchParams.set("agentName", agentName || "");
    url.searchParams.set("leadName", leadName || "");
    url.searchParams.set("agentTimeZone", agentTimeZone || "America/New_York");
  }

  try {
    const { client } = await resolveTwilioClient(userEmail);
    let from = normalizeE164(fromNumberRaw);
    if (!from) {
      const numbers = await client.incomingPhoneNumbers.list({ limit: 1 });
      from = normalizeE164(numbers[0]?.phoneNumber || "");
    }
    if (!from) {
      throw new Error("No valid Twilio from number available for agent transfer");
    }

    const agentCallOptions: any = {
      to: agentTo,
      from,
      url: bridgeUrl.toString(),
      method: "POST",
      machineDetection: "Enable",
      machineDetectionTimeout: 3,
      statusCallback: amdCallbackUrl.toString(),
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      timeout: 15,
    };

    await client.calls.create(agentCallOptions);
    console.log("[TRANSFER-TWIML] Agent leg created for two-leg transfer", {
      conferenceName,
      leadCallSid: callSid,
      userEmail,
    });
  } catch (err: any) {
    console.error("[TRANSFER-TWIML] Failed to create agent leg:", err?.message || err);
    const rebootUrl = new URL("/api/ai-calls/transfer-reboot-twiml", COVECRM_BASE_URL);
    rebootUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
    rebootUrl.searchParams.set("leadId", leadId);
    rebootUrl.searchParams.set("leadName", leadName);
    rebootUrl.searchParams.set("agentName", agentName);
    rebootUrl.searchParams.set("userEmail", userEmail);
    rebootUrl.searchParams.set("sessionId", sessionId);
    rebootUrl.searchParams.set("callSid", callSid);
    rebootUrl.searchParams.set("agentTimeZone", agentTimeZone || "America/New_York");
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${xmlEscape(rebootUrl.toString())}</Redirect>
</Response>`);
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">Please hold for just a moment while I connect you.</Say>
  <Dial action="${xmlEscape(fallbackUrl.toString())}" method="POST">
    <Conference waitUrl=""
                waitMethod="GET"
                beep="false"
                startConferenceOnEnter="false"
                endConferenceOnExit="true"
                muted="false">${xmlEscape(conferenceName)}</Conference>
  </Dial>
</Response>`;

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(twiml);
}

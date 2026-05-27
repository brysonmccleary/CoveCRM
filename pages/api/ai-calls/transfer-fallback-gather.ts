import type { NextApiRequest, NextApiResponse } from "next";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_DIALER_AGENT_KEY = process.env.AI_DIALER_AGENT_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = req.query;
  const key           = Array.isArray(q.key)           ? q.key[0]           : String(q.key           || "");
  const leadId        = Array.isArray(q.leadId)        ? q.leadId[0]        : String(q.leadId        || "");
  const leadName      = Array.isArray(q.leadName)      ? q.leadName[0]      : String(q.leadName      || "");
  const agentName     = Array.isArray(q.agentName)     ? q.agentName[0]     : String(q.agentName     || "");
  const sessionId     = Array.isArray(q.sessionId)     ? q.sessionId[0]     : String(q.sessionId     || "");
  const callSid       = Array.isArray(q.callSid)       ? q.callSid[0]       : String(q.callSid       || "");

  if (!key || key !== AI_DIALER_CRON_KEY) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const body = req.body as Record<string, string> | undefined;
  const speechResult = String(body?.SpeechResult || "").toLowerCase().trim();

  const agentFirst = (agentName || "our agent").split(" ")[0] || "our agent";
  const safeAgentFirst = xmlEscape(agentFirst);
  const safeLeadName = leadName ? xmlEscape(leadName) : "";

  const wantsToday    = /\btoday\b|\bthis (afternoon|morning|evening)\b/.test(speechResult);
  const wantsTomorrow = /\btomorrow\b/.test(speechResult);

  let confirmLine: string;
  let outcomeNote: string;

  if (wantsToday) {
    confirmLine  = `Perfect${safeLeadName ? ", " + safeLeadName : ""}. ${safeAgentFirst} will give you a call back later today. Talk soon!`;
    outcomeNote  = "Lead requested callback later today after failed live transfer.";
  } else if (wantsTomorrow) {
    confirmLine  = `Perfect${safeLeadName ? ", " + safeLeadName : ""}. ${safeAgentFirst} will reach out tomorrow. Have a great day!`;
    outcomeNote  = "Lead requested callback tomorrow after failed live transfer.";
  } else if (speechResult) {
    confirmLine  = `Got it${safeLeadName ? ", " + safeLeadName : ""}. ${safeAgentFirst} will be in touch with you very soon. Have a great day!`;
    outcomeNote  = `Lead responded after failed transfer: "${speechResult}". Follow up needed.`;
  } else {
    confirmLine  = `No problem${safeLeadName ? ", " + safeLeadName : ""}. ${safeAgentFirst} will reach out to you soon. Have a great day!`;
    outcomeNote  = "No speech gathered after failed live transfer. Follow up needed.";
  }

  try {
    await fetch(`${COVECRM_BASE_URL}/api/ai-calls/outcome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agent-key": AI_DIALER_AGENT_KEY,
      },
      body: JSON.stringify({
        callSid,
        outcome: "callback_requested",
        summary: outcomeNote,
      }),
    });
  } catch (e) {
    console.error("[TRANSFER-FALLBACK-GATHER] outcome error", e);
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" rate="90%">${xmlEscape(confirmLine)}</Say>
  <Hangup/>
</Response>`);
}

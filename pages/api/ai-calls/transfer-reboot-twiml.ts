import type { NextApiRequest, NextApiResponse } from "next";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_VOICE_WSS_URL =
  process.env.AI_VOICE_WSS_URL ||
  process.env.AI_VOICE_STREAM_URL ||
  "";

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = req.query;
  const key         = Array.isArray(q.key)         ? q.key[0]         : String(q.key         || "");
  const leadId      = Array.isArray(q.leadId)      ? q.leadId[0]      : String(q.leadId      || "");
  const sessionId   = Array.isArray(q.sessionId)   ? q.sessionId[0]   : String(q.sessionId   || "");
  const leadName    = Array.isArray(q.leadName)     ? q.leadName[0]    : String(q.leadName    || "");
  const agentName   = Array.isArray(q.agentName)   ? q.agentName[0]   : String(q.agentName   || "");
  const userEmail   = Array.isArray(q.userEmail)   ? q.userEmail[0]   : String(q.userEmail   || "");
  const callSid     = Array.isArray(q.callSid)     ? q.callSid[0]     : String(q.callSid     || "");
  const agentTimeZone = Array.isArray(q.agentTimeZone) ? q.agentTimeZone[0] : String(q.agentTimeZone || "America/New_York");

  if (!key || key !== AI_DIALER_CRON_KEY) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (!AI_VOICE_WSS_URL) {
    console.error("[TRANSFER-REBOOT-TWIML] AI_VOICE_WSS_URL not configured");
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEscape(AI_VOICE_WSS_URL)}">
      <Parameter name="sessionId" value="${xmlEscape(sessionId)}"/>
      <Parameter name="leadId" value="${xmlEscape(leadId)}"/>
      <Parameter name="rebookingMode" value="true"/>
      <Parameter name="leadName" value="${xmlEscape(leadName)}"/>
      <Parameter name="agentName" value="${xmlEscape(agentName)}"/>
      <Parameter name="userEmail" value="${xmlEscape(userEmail)}"/>
      <Parameter name="callSid" value="${xmlEscape(callSid)}"/>
      <Parameter name="agentTimeZone" value="${xmlEscape(agentTimeZone)}"/>
      <Parameter name="callDirection" value="outbound"/>
    </Stream>
  </Connect>
</Response>`);
}

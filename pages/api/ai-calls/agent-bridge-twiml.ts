import type { NextApiRequest, NextApiResponse } from "next";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = getQueryValue(req.query.key);
  if (!key || !AI_DIALER_CRON_KEY || key !== AI_DIALER_CRON_KEY) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const conferenceName = getQueryValue(req.query.conferenceName);
  const leadCallSid = getQueryValue(req.query.leadCallSid);
  const agentName = getQueryValue(req.query.agentName);
  const leadName = getQueryValue(req.query.leadName);
  const scope = getQueryValue(req.query.scope);
  const answeredBy = String(req.body?.AnsweredBy || "unknown").toLowerCase();

  if (!conferenceName) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (answeredBy && answeredBy !== "human") {
    console.log("[AGENT-BRIDGE] non-human AMD — hanging up agent leg; fallback owns lead reboot", {
      conferenceName,
      leadCallSid,
      answeredBy,
    });
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const agentFirst = agentName ? agentName.split(" ")[0] : "";
  const whisper = agentFirst && leadName && scope
    ? `Hey ${agentFirst}, I have ${leadName} on the line to go over ${scope}. Have a great day!`
    : agentFirst && leadName
    ? `Hey ${agentFirst}, I have ${leadName} on the line for you. Have a great day!`
    : "Hey, I have your lead on the line for you. Have a great day!";

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural">${xmlEscape(whisper)}</Say>
  <Dial>
    <Conference beep="false"
                startConferenceOnEnter="true"
                endConferenceOnExit="true"
                muted="false">${xmlEscape(conferenceName)}</Conference>
  </Dial>
</Response>`);
}

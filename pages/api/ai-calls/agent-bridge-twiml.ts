import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

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

function getQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
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

async function redirectLeadToReboot(params: {
  leadCallSid: string;
  leadId: string;
  leadName: string;
  agentName: string;
  userEmail: string;
  sessionId: string;
  agentTimeZone: string;
}) {
  const { client } = await resolveTwilioClient(params.userEmail);
  const rebootUrl = new URL("/api/ai-calls/transfer-reboot-twiml", COVECRM_BASE_URL);
  rebootUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
  rebootUrl.searchParams.set("leadId", params.leadId);
  rebootUrl.searchParams.set("leadName", params.leadName);
  rebootUrl.searchParams.set("agentName", params.agentName);
  rebootUrl.searchParams.set("userEmail", params.userEmail);
  rebootUrl.searchParams.set("sessionId", params.sessionId);
  rebootUrl.searchParams.set("callSid", params.leadCallSid);
  rebootUrl.searchParams.set("agentTimeZone", params.agentTimeZone || "America/New_York");

  await client.calls(params.leadCallSid).update({
    url: rebootUrl.toString(),
    method: "POST",
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const key = getQueryValue(req.query.key);
  if (!key || !AI_DIALER_CRON_KEY || key !== AI_DIALER_CRON_KEY) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  const conferenceName = getQueryValue(req.query.conferenceName);
  const leadCallSid = getQueryValue(req.query.leadCallSid);
  const sessionId = getQueryValue(req.query.sessionId);
  const leadId = getQueryValue(req.query.leadId);
  const userEmail = getQueryValue(req.query.userEmail).toLowerCase();
  const agentName = getQueryValue(req.query.agentName);
  const leadName = getQueryValue(req.query.leadName);
  const agentTimeZone = getQueryValue(req.query.agentTimeZone) || "America/New_York";
  const answeredBy = String(req.body?.AnsweredBy || "").toLowerCase();

  if (!conferenceName) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  if (answeredBy && answeredBy !== "human") {
    try {
      if (leadCallSid) {
        await redirectLeadToReboot({
          leadCallSid,
          leadId,
          leadName,
          agentName,
          userEmail,
          sessionId,
          agentTimeZone,
        });
      }
    } catch (err: any) {
      console.error("[AGENT-BRIDGE] failed to redirect lead after non-human AMD:", err?.message || err);
    }
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
  }

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference beep="false"
                startConferenceOnEnter="true"
                endConferenceOnExit="true"
                muted="false">${xmlEscape(conferenceName)}</Conference>
  </Dial>
</Response>`);
}

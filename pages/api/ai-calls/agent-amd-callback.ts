import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import AICallRecording from "@/models/AICallRecording";
import mongooseConnect from "@/lib/mongooseConnect";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

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
    return res.status(401).send("Unauthorized");
  }

  const body = req.body || {};
  const answeredBy = String(body.AnsweredBy || "").toLowerCase();
  const callStatus = String(body.CallStatus || "").toLowerCase();
  const dialCallStatus = String(body.DialCallStatus || "").toLowerCase();
  const agentCallSid = String(body.CallSid || "").trim();

  const conferenceName = getQueryValue(req.query.conferenceName);
  const leadCallSid = getQueryValue(req.query.leadCallSid);
  const sessionId = getQueryValue(req.query.sessionId);
  const leadId = getQueryValue(req.query.leadId);
  const userEmail = getQueryValue(req.query.userEmail).toLowerCase();
  const agentName = getQueryValue(req.query.agentName);
  const leadName = getQueryValue(req.query.leadName);
  const agentTimeZone = getQueryValue(req.query.agentTimeZone) || "America/New_York";

  const isHuman = answeredBy === "human";
  const isFailed =
    ["busy", "no-answer", "failed", "canceled"].includes(callStatus) ||
    ["busy", "no-answer", "failed", "canceled"].includes(dialCallStatus);
  const isMachine = answeredBy.includes("machine") || answeredBy === "fax";
  const isUnknown = answeredBy === "unknown";

  if (isHuman) {
    console.log("[AGENT-AMD] human confirmed — agent will join conference", {
      conferenceName,
      leadCallSid,
      agentCallSid,
    });
    return res.status(200).send("");
  }

  if (isMachine || isFailed || (isUnknown && callStatus === "completed")) {
    try {
      const { client } = await resolveTwilioClient(userEmail);
      if (agentCallSid) {
        await client.calls(agentCallSid).update({ status: "completed" }).catch(() => {});
      }
      if (leadCallSid) {
        try {
          await mongooseConnect();
          await AICallRecording.updateOne(
            { callSid: leadCallSid },
            {
              $set: {
                transferRebootPending: true,
                transferRebootedAt: new Date(),
              },
            }
          );
          console.log("[AGENT-AMD] marked transferRebootPending on lead call record", {
            leadCallSid,
          });
        } catch (err) {
          console.warn("[AGENT-AMD] could not mark transferRebootPending", err);
        }

        await redirectLeadToReboot({
          leadCallSid,
          leadId,
          leadName,
          agentName,
          userEmail,
          sessionId,
          agentTimeZone,
        });

        // Mark lead as already rebooted so transfer-fallback skips its redirect
        try {
          const markUrl = new URL("/api/ai-calls/transfer-fallback", COVECRM_BASE_URL);
          markUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
          markUrl.searchParams.set("amdRebooted", "true");
          markUrl.searchParams.set("leadCallSid", leadCallSid);
          markUrl.searchParams.set("conferenceName", conferenceName);
          // Fire and forget — just a signal, not critical
          fetch(markUrl.toString(), { method: "POST" }).catch(() => {});
        } catch {}
      }
      console.log("[AGENT-AMD] machine/failed/unknown — redirecting lead to reboot", {
        conferenceName,
        leadCallSid,
        agentCallSid,
        answeredBy,
        callStatus,
        dialCallStatus,
      });
    } catch (err: any) {
      console.error("[AGENT-AMD] failed to redirect lead to reboot:", err?.message || err);
    }
    return res.status(200).send("");
  }

  return res.status(200).send("");
}

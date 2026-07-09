import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import twilio from "twilio";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import AICallRecording from "@/models/AICallRecording";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import {
  finalizeLiveTransferUsage,
  markLiveTransferAgentAnswered,
  markLiveTransferNoHumanAnswer,
} from "@/lib/billing/liveTransferUsage";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";
const PLATFORM_AUTH_TOKEN = (process.env.TWILIO_AUTH_TOKEN || "").trim();

export const config = { api: { bodyParser: false } };

function getQueryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

function candidateCallbackUrls(req: NextApiRequest): string[] {
  const requestPath = req.url || "/api/ai-calls/agent-amd-callback";
  const configured = new URL(requestPath, `${COVECRM_BASE_URL.replace(/\/$/, "")}/`).toString();
  const host = String(req.headers.host || "").trim();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
  const requestHostUrl = host ? `${forwardedProto}://${host}${requestPath}` : "";
  const urls = [configured, requestHostUrl].filter(Boolean);
  const configuredUrl = new URL(configured);
  const alternateHost = configuredUrl.hostname.startsWith("www.")
    ? configuredUrl.hostname.replace(/^www\./, "")
    : `www.${configuredUrl.hostname}`;
  urls.push(`${configuredUrl.protocol}//${alternateHost}${configuredUrl.port ? `:${configuredUrl.port}` : ""}${configuredUrl.pathname}${configuredUrl.search}`);
  return [...new Set(urls)];
}

function validatesTwilioSignature(args: {
  signature: string;
  params: Record<string, string>;
  urls: string[];
  tokens: Array<string | undefined | null>;
}) {
  if (!args.signature) return false;
  for (const token of args.tokens) {
    const authToken = String(token || "").trim();
    if (!authToken) continue;
    for (const url of args.urls) {
      if (twilio.validateRequest(authToken, args.signature, url, args.params)) return true;
    }
  }
  return false;
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
  const key = getQueryValue(req.query.key);
  if (!key || !AI_DIALER_CRON_KEY || key !== AI_DIALER_CRON_KEY) {
    return res.status(401).send("Unauthorized");
  }

  const raw = await buffer(req);
  const params = new URLSearchParams(raw.toString("utf8"));
  const body = Object.fromEntries(params.entries());
  const userEmail = getQueryValue(req.query.userEmail).toLowerCase();
  const callbackUser = userEmail
    ? await User.findOne({ email: userEmail }).select("twilio.authToken").lean()
    : null;
  const validSignature = validatesTwilioSignature({
    signature: String(req.headers["x-twilio-signature"] || ""),
    params: body,
    urls: candidateCallbackUrls(req),
    tokens: [PLATFORM_AUTH_TOKEN, (callbackUser as any)?.twilio?.authToken],
  });
  if (!validSignature) {
    console.warn("[AGENT-AMD] rejected callback with invalid or missing Twilio signature");
    return res.status(403).send("Invalid signature");
  }

  const answeredBy = String(body.AnsweredBy || "").toLowerCase();
  const callStatus = String(body.CallStatus || "").toLowerCase();
  const dialCallStatus = String(body.DialCallStatus || "").toLowerCase();
  const agentCallSid = String(body.CallSid || "").trim();

  const conferenceName = getQueryValue(req.query.conferenceName);
  const leadCallSid = getQueryValue(req.query.leadCallSid);
  const sessionId = getQueryValue(req.query.sessionId);
  const leadId = getQueryValue(req.query.leadId);
  const leadName = getQueryValue(req.query.leadName);
  const agentName = getQueryValue(req.query.agentName);
  const agentTimeZone = getQueryValue(req.query.agentTimeZone);

  const isHuman = answeredBy === "human";
  const isFailed =
    ["busy", "no-answer", "failed", "canceled"].includes(callStatus) ||
    ["busy", "no-answer", "failed", "canceled"].includes(dialCallStatus);
  const isMachine = answeredBy.includes("machine") || answeredBy === "fax";
  const isUnknown = answeredBy === "unknown";
  const isTerminal = ["completed", "busy", "no-answer", "failed", "canceled"].includes(callStatus);

  if (isTerminal && agentCallSid) {
    try {
      const finalized = await finalizeLiveTransferUsage({
        agentCallSid,
        endedAt: String(body.Timestamp || ""),
      });
      if (!finalized) await markLiveTransferNoHumanAnswer(agentCallSid);
    } catch (err: any) {
      console.error("[AGENT-AMD] live transfer usage finalization failed", err?.message || err);
    }
  }

  if (isHuman && ["answered", "in-progress"].includes(callStatus)) {
    try {
      await markLiveTransferAgentAnswered({
        agentCallSid,
        answeredAt: String(body.Timestamp || ""),
      });
    } catch (err: any) {
      console.error("[AGENT-AMD] live transfer usage meter start failed", err?.message || err);
    }
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
          const result = await AICallRecording.updateOne(
            { callSid: leadCallSid },
            {
              $set: {
                transferRebootPending: true,
                transferRebootedAt: new Date(),
              },
            }
          );
          console.log("[AGENT-AMD] transferRebootPending write result", {
            leadCallSid,
            matchedCount: result.matchedCount,
            modifiedCount: result.modifiedCount,
          });
          console.log("[AGENT-AMD] marked transferRebootPending on lead call record", {
            leadCallSid,
          });
        } catch (err) {
          console.warn("[AGENT-AMD] could not mark transferRebootPending", err);
        }

        try {
          const rebootUrl = new URL("/api/ai-calls/transfer-reboot-twiml", COVECRM_BASE_URL);
          rebootUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
          rebootUrl.searchParams.set("sessionId", sessionId);
          rebootUrl.searchParams.set("leadId", leadId);
          rebootUrl.searchParams.set("leadName", leadName);
          rebootUrl.searchParams.set("agentName", agentName);
          rebootUrl.searchParams.set("userEmail", userEmail);
          rebootUrl.searchParams.set("callSid", leadCallSid);
          rebootUrl.searchParams.set("agentTimeZone", agentTimeZone || "America/New_York");

          await client.calls(leadCallSid).update({
            url: rebootUrl.toString(),
            method: "POST",
          });
          console.log("[AGENT-AMD] redirected lead call to AI reboot after failed transfer", {
            leadCallSid,
            agentCallSid,
            answeredBy,
            callStatus,
            dialCallStatus,
          });
        } catch (err) {
          console.warn("[AGENT-AMD] failed to redirect lead call to AI reboot", err);
        }
      }
      console.log("[AGENT-AMD] machine/failed/unknown — marked transfer reboot pending", {
        conferenceName,
        leadCallSid,
        agentCallSid,
        answeredBy,
        callStatus,
        dialCallStatus,
      });
    } catch (err: any) {
      console.error("[AGENT-AMD] failed to mark transfer reboot pending:", err?.message || err);
    }
    return res.status(200).send("");
  }

  return res.status(200).send("");
}

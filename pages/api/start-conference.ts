// pages/api/start-conference.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Twilio from "twilio";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]"; // relative to /pages/api

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_CALLER_ID,
  NEXT_PUBLIC_BASE_URL,
  NEXTAUTH_URL,
} = process.env;

const client =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN
    ? Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    : null;

function sendJSON(res: NextApiResponse, status: number, body: any) {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function e164(num: string) {
  if (!num) return "";
  const d = num.replace(/\D+/g, "");
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (num.startsWith("+")) return num.trim();
  return `+${d}`;
}

function identityFromEmail(email: string) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 120);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return sendJSON(res, 405, { message: "Method not allowed" });
  }

  try {
    // Auth so we can derive Twilio Client identity (never PSTN)
    const session = (await getServerSession(req, res, authOptions)) as any;
    const userEmail = String(session?.user?.email || "");
    if (!userEmail) {
      return sendJSON(res, 401, { message: "Unauthorized" });
    }
    const clientIdentity = identityFromEmail(userEmail);

    if (!client) {
      return sendJSON(res, 500, { message: "Server Twilio client not configured" });
    }

    const baseUrl = (NEXT_PUBLIC_BASE_URL || NEXTAUTH_URL || "").replace(/\/$/, "");
    if (!baseUrl) return sendJSON(res, 500, { message: "Base URL not configured" });
    if (!TWILIO_CALLER_ID) return sendJSON(res, 500, { message: "TWILIO_CALLER_ID missing" });

    // Legacy callers might send agentNumber — we intentionally IGNORE it.
    const { leadNumber, agentNumber: _ignored, leadId } = (req.body ?? {}) as {
      leadNumber?: string;
      agentNumber?: string;
      leadId?: string;
    };

    const toLead = e164(leadNumber || "");
    if (!toLead) {
      return sendJSON(res, 400, { message: "Missing or invalid leadNumber" });
    }

    const conferenceName = `conf_${Date.now()}`;
    const agentUrl = `${baseUrl}/api/voice/agent-join?conferenceName=${encodeURIComponent(conferenceName)}`;
    const leadUrl  = `${baseUrl}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

    console.log("start-conference:init", {
      conferenceName,
      from: TWILIO_CALLER_ID,
      toLead,
      toAgentClient: `client:${clientIdentity}`,
      note: "PSTN agent disabled; using Twilio Client only",
    });

    // 1) Agent "web" leg (Twilio Client) — cannot ring your cell
    const agentCall = await client.calls.create({
      to: `client:${clientIdentity}`,
      from: TWILIO_CALLER_ID,
      url: agentUrl,
      statusCallback: `${baseUrl}/api/twilio/status-callback${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    // 2) Lead PSTN leg
    const leadCall = await client.calls.create({
      to: toLead,
      from: TWILIO_CALLER_ID,
      url: leadUrl,
      statusCallback: `${baseUrl}/api/twilio/status-callback${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      // Optional AMD at create; TwiML can also handle detection if desired
      machineDetection: "DetectMessageEnd" as any,
      recordingStatusCallback: `${baseUrl}/api/twilio-recording`,
      recordingStatusCallbackEvent: ["completed"],
    });

    console.log("start-conference:placed", {
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      from: TWILIO_CALLER_ID,
      toLead,
      toAgentClient: `client:${clientIdentity}`,
    });

    return sendJSON(res, 200, {
      success: true,
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      from: TWILIO_CALLER_ID,
      toLead,
      toAgentClient: `client:${clientIdentity}`,
    });
  } catch (err: any) {
    console.error("Twilio start-conference error:", {
      message: err?.message,
      code: err?.code,
      moreInfo: err?.moreInfo,
    });
    return sendJSON(res, 502, {
      message: "Twilio error starting conference",
      code: err?.code,
      detail: err?.message,
    });
  }
}

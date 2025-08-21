// pages/api/start-conference.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Twilio from "twilio";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]"; // path is relative to /pages/api

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
    // Authenticate so we can derive the agent's Twilio Client identity
    const session = await getServerSession(req, res, authOptions as any);
    if (!session?.user?.email) {
      return sendJSON(res, 401, { message: "Unauthorized" });
    }
    const userEmail = String(session.user.email).toLowerCase();
    const clientIdentity = identityFromEmail(userEmail);

    if (!client) {
      return sendJSON(res, 500, { message: "Server Twilio client not configured" });
    }

    const baseUrl = (NEXT_PUBLIC_BASE_URL || NEXTAUTH_URL || "").replace(/\/$/, "");
    if (!baseUrl) return sendJSON(res, 500, { message: "Base URL not configured" });
    if (!TWILIO_CALLER_ID) return sendJSON(res, 500, { message: "TWILIO_CALLER_ID missing" });

    // Legacy callers may still send agentNumber; we IGNORE it on purpose.
    const { leadNumber, agentNumber: _ignoredAgentNumber, leadId } = (req.body ?? {}) as {
      leadNumber?: string;
      agentNumber?: string; // ignored
      leadId?: string;
    };

    const toLead = e164(leadNumber || "");
    if (!toLead) {
      return sendJSON(res, 400, { message: "Missing or invalid leadNumber" });
    }

    const conferenceName = `conf_${Date.now()}`;
    const agentUrl = `${baseUrl}/api/voice/agent-join?conferenceName=${encodeURIComponent(conferenceName)}`;
    const leadUrl  = `${baseUrl}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

    console.log("start-conference: initializing", {
      conferenceName,
      from: TWILIO_CALLER_ID,
      toLead,
      toAgentClient: `client:${clientIdentity}`,
      note: "agent PSTN intentionally disabled; using Twilio Client",
    });

    // 1) Agent "web" leg (Twilio Client) — this will NOT dial your phone
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
      // Let Twilio record from answer if configured by your TwiML
      recordingStatusCallback: `${baseUrl}/api/twilio-recording`,
      recordingStatusCallbackEvent: ["completed"],
      statusCallback: `${baseUrl}/api/twilio/status-callback${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      // Optional AMD on create (kept simple; the TwiML can also handle it)
      machineDetection: "DetectMessageEnd" as any,
    });

    console.log("start-conference: calls placed", {
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      toLead,
      from: TWILIO_CALLER_ID,
      toAgentClient: `client:${clientIdentity}`,
    });

    return sendJSON(res, 200, {
      success: true,
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      toLead,
      from: TWILIO_CALLER_ID,
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

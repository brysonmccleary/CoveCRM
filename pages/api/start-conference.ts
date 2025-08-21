// pages/api/start-conference.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Twilio from "twilio";

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return sendJSON(res, 405, { message: "Method not allowed" });
  }

  try {
    if (!client) {
      return sendJSON(res, 500, { message: "Server Twilio client not configured" });
    }

    const baseUrl = (NEXT_PUBLIC_BASE_URL || NEXTAUTH_URL || "").replace(/\/$/, "");
    if (!baseUrl) return sendJSON(res, 500, { message: "Base URL not configured" });
    if (!TWILIO_CALLER_ID) return sendJSON(res, 500, { message: "TWILIO_CALLER_ID missing" });

    const { leadNumber, agentNumber, leadId } = (req.body ?? {}) as {
      leadNumber?: string;
      agentNumber?: string;
      leadId?: string;
    };

    if (!leadNumber || !agentNumber) {
      return sendJSON(res, 400, { message: "Missing leadNumber or agentNumber" });
    }

    const conferenceName = `conf_${Date.now()}`;
    const agentUrl = `${baseUrl}/api/voice/agent-join?conferenceName=${encodeURIComponent(conferenceName)}`;
    const leadUrl  = `${baseUrl}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

    console.log("start-conference", {
      conferenceName,
      agentNumberMasked: agentNumber.replace(/.(?=.{4})/g, "•"),
      leadNumberMasked: leadNumber.replace(/.(?=.{4})/g, "•"),
      from: TWILIO_CALLER_ID,
      agentUrl,
      leadUrl,
    });

    // 1) Call the AGENT first
    const agentCall = await client.calls.create({
      to: agentNumber,
      from: TWILIO_CALLER_ID,
      url: agentUrl,
      statusCallback: `${baseUrl}/api/twilio/voice-status${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    // 2) Then call the LEAD (record from answer)
    const leadCall = await client.calls.create({
      to: leadNumber,
      from: TWILIO_CALLER_ID,
      url: leadUrl,
      record: true, // <-- boolean; starts recording on answer
      // recordingChannels: "mono", // optional; set "dual" if you want split tracks
      recordingStatusCallback: `${baseUrl}/api/twilio-recording`,
      recordingStatusCallbackEvent: ["completed"],
      statusCallback: `${baseUrl}/api/twilio/voice-status${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    return sendJSON(res, 200, {
      success: true,
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
    });
  } catch (err: any) {
    console.error("Twilio conference error:", {
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

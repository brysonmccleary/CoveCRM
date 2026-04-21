// pages/api/start-conference.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]"; // relative to /pages/api
import { checkCallingAllowed } from "@/lib/billing/checkCallingAllowed";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const { NEXT_PUBLIC_BASE_URL, NEXTAUTH_URL } = process.env;

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

function findOwnedUserNumber(user: any, phoneNumber: string) {
  const normalized = e164(phoneNumber);
  if (!normalized) return null;
  return (
    ((user as any)?.numbers || []).find(
      (entry: any) => e164(String(entry?.phoneNumber || "")) === normalized,
    ) || null
  );
}

function resolveConfiguredCallerId(user: any): string {
  const configuredPhone = e164(
    String((user as any)?.defaultVoiceNumber || (user as any)?.defaultFromNumber || ""),
  );
  if (configuredPhone && findOwnedUserNumber(user, configuredPhone)?.phoneNumber) {
    return configuredPhone;
  }

  const defaultSmsNumberId = String((user as any)?.defaultSmsNumberId || "");
  if (defaultSmsNumberId) {
    const owned = ((user as any)?.numbers || []).find((entry: any) => {
      const entryId = entry?._id ? String(entry._id) : "";
      return entryId === defaultSmsNumberId || String(entry?.sid || "") === defaultSmsNumberId;
    });
    const fallbackPhone = e164(String(owned?.phoneNumber || ""));
    if (fallbackPhone) return fallbackPhone;
  }

  return "";
}

async function validateFromInActiveAccount(client: any, phoneNumber: string) {
  try {
    const list = await client.incomingPhoneNumbers.list({
      phoneNumber,
      limit: 1,
    });
    return Array.isArray(list) && list.length > 0;
  } catch {
    return false;
  }
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

    const billingCheck = await checkCallingAllowed(userEmail);
    if (!billingCheck.allowed) {
      return sendJSON(res, 402, { message: billingCheck.reason });
    }

    const baseUrl = (NEXT_PUBLIC_BASE_URL || NEXTAUTH_URL || "").replace(/\/$/, "");
    if (!baseUrl) return sendJSON(res, 500, { message: "Base URL not configured" });

    // Incoming body (we ignore agentNumber by design)
    const {
      leadNumber,
      agentNumber: _ignored,
      leadId,
      from: fromBody,
      fromNumber: fromNumberBody,
    } = (req.body ?? {}) as {
      leadNumber?: string;
      agentNumber?: string;
      leadId?: string;
      from?: string;
      fromNumber?: string;
    };

    const toLead = e164(leadNumber || "");
    if (!toLead) {
      return sendJSON(res, 400, { message: "Missing or invalid leadNumber" });
    }

    // ✅ Dynamic, per-user caller ID (fully automated)
    const { client, accountSid, user } = await getClientForUser(userEmail);
    const requestedFromRaw = String(fromNumberBody || fromBody || "").trim();
    const requestedFrom = requestedFromRaw ? e164(requestedFromRaw) : "";

    if (requestedFromRaw && !requestedFrom) {
      return sendJSON(res, 400, { message: "Invalid outbound number." });
    }

    const fromNumber = requestedFrom || resolveConfiguredCallerId(user);
    if (!fromNumber) {
      return sendJSON(res, 400, { message: "No assigned outbound number configured." });
    }

    if (!findOwnedUserNumber(user, fromNumber)) {
      console.warn("start-conference: requested outbound number not assigned", {
        userEmail,
        userId: (user as any)?._id ? String((user as any)._id) : null,
        requestedFrom: requestedFrom || null,
        resolvedFrom: fromNumber,
      });
      return sendJSON(res, 403, {
        message: "Requested outbound number is not assigned to this account.",
      });
    }

    const activeAccountHasNumber = await validateFromInActiveAccount(
      client,
      fromNumber,
    );
    if (!activeAccountHasNumber) {
      console.warn("start-conference: outbound number/account mismatch", {
        userEmail,
        userId: (user as any)?._id ? String((user as any)._id) : null,
        accountSid,
        requestedFrom: requestedFrom || null,
        resolvedFrom: fromNumber,
      });
      return sendJSON(res, 409, { message: "Outbound number/account mismatch." });
    }

    const conferenceName = `conf_${Date.now()}`;
    const agentUrl = `${baseUrl}/api/voice/agent-join?conferenceName=${encodeURIComponent(conferenceName)}`;
    const leadUrl  = `${baseUrl}/api/voice/lead-join?conferenceName=${encodeURIComponent(conferenceName)}`;

    console.log("start-conference:init", {
      conferenceName,
      from: fromNumber,
      toLead,
      toAgentClient: `client:${clientIdentity}`,
      note: "PSTN agent disabled; using Twilio Client only",
    });

    // 1) Agent "web" leg (Twilio Client)
    const agentCall = await client.calls.create({
      to: `client:${clientIdentity}`,
      from: fromNumber,
      url: agentUrl,
      statusCallback: `${baseUrl}/api/twilio/status-callback${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    // 2) Lead PSTN leg
    const leadCall = await client.calls.create({
      to: toLead,
      from: fromNumber,
      url: leadUrl,
      statusCallback: `${baseUrl}/api/twilio/status-callback${leadId ? `?leadId=${encodeURIComponent(leadId)}` : ""}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      machineDetection: "DetectMessageEnd" as any,
      asyncAmd: "true",
      recordingStatusCallback: `${baseUrl}/api/twilio-recording`,
      recordingStatusCallbackEvent: ["completed"],
    });

    console.log("start-conference:placed", {
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      from: fromNumber,
      toLead,
      toAgentClient: `client:${clientIdentity}`,
    });

    return sendJSON(res, 200, {
      success: true,
      conferenceName,
      agentCallSid: agentCall.sid,
      leadCallSid: leadCall.sid,
      from: fromNumber,
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

import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const REQ_HEADER = "authorization";
const CRON_SECRET = process.env.CRON_SECRET || "";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID!;
const AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN!;
const MS_SID       = process.env.TWILIO_MESSAGING_SERVICE_SID || ""; // optional but recommended

// Canonical webhook endpoints
const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
const VOICE_URL = `${BASE}/api/twilio/voice/inbound`;
const SMS_URL   = `${BASE}/api/twilio/inbound-sms`;
const VOICE_STATUS = `${BASE}/api/twilio/voice-status`;

type Fix = { sid: string; phoneNumber?: string | null; changed: string[] };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth gate
  const auth = String(req.headers[REQ_HEADER] || "");
  if (!CRON_SECRET || auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  try {
    const client = twilio(ACCOUNT_SID, AUTH_TOKEN);

    // 1) Ensure Messaging Service webhooks (if present)
    let msFixed = false;
    if (MS_SID) {
      try {
        const ms = await client.messaging.v1.services(MS_SID).fetch();

        const wantInbound = SMS_URL;
        const wantStatus  = `${BASE}/api/twilio/status-callback`; // optional status cb you already use elsewhere

        const needInbound = (ms as any).inboundRequestUrl !== wantInbound;
        const needStatus  = (ms as any).statusCallback !== wantStatus;

        if (needInbound || needStatus) {
          await client.messaging.v1.services(MS_SID).update({
            inboundRequestUrl: wantInbound,
            statusCallback: wantStatus,
          } as any);
          msFixed = true;
        }
      } catch (e) {
        console.warn("verify-webhooks: messaging service fetch/update failed:", (e as any)?.message || e);
      }
    }

    // 2) Walk all IncomingPhoneNumbers on the master account and enforce Voice/SMS webhooks
    const fixes: Fix[] = [];
    const pageSize = 1000;
    let page = await client.incomingPhoneNumbers.list({ pageSize });
    while (page.length) {
      for (const pn of page) {
        const desired: any = {
          voiceUrl: VOICE_URL,
          voiceMethod: "POST",
          statusCallback: `${VOICE_STATUS}?userEmail=${encodeURIComponent((pn as any).friendlyName || "")}`,
          smsUrl: SMS_URL,
          smsMethod: "POST",
        };

        // Build a list of differences
        const changed: string[] = [];
        const current: any = pn as any;

        if (current.voiceUrl !== desired.voiceUrl) changed.push("voiceUrl");
        if (String(current.voiceMethod || "").toUpperCase() !== "POST") changed.push("voiceMethod");
        if (current.statusCallback !== desired.statusCallback) changed.push("statusCallback");
        if (current.smsUrl !== desired.smsUrl) changed.push("smsUrl");
        if (String(current.smsMethod || "").toUpperCase() !== "POST") changed.push("smsMethod");

        if (changed.length) {
          try {
            await client.incomingPhoneNumbers(pn.sid).update(desired);
            fixes.push({ sid: pn.sid, phoneNumber: pn.phoneNumber, changed });
          } catch (e) {
            console.warn(`verify-webhooks: failed update for ${pn.sid}`, (e as any)?.message || e);
          }
        }
      }
      page = page.length < pageSize ? [] : await client.incomingPhoneNumbers.list({ pageSize });
    }

    return res.status(200).json({
      ok: true,
      fixed: fixes.length,
      msFixed,
      details: fixes,
    });
  } catch (err: any) {
    console.error("verify-webhooks error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Internal error" });
  }
}

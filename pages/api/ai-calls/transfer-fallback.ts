// pages/api/ai-calls/transfer-fallback.ts
// Called by Twilio if the agent doesn't answer on live transfer.
// Attempts to book the appointment automatically, then says an appropriate message.
import type { NextApiRequest, NextApiResponse } from "next";
import { sendEmail } from "@/lib/email";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_DIALER_AGENT_KEY = process.env.AI_DIALER_AGENT_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = req.query;
  const key           = Array.isArray(q.key)           ? q.key[0]           : String(q.key           || "");
  const sessionId     = Array.isArray(q.sessionId)     ? q.sessionId[0]     : String(q.sessionId     || "");
  const leadId        = Array.isArray(q.leadId)        ? q.leadId[0]        : String(q.leadId        || "");
  const callSid       = Array.isArray(q.callSid)       ? q.callSid[0]       : String(q.callSid       || "");
  const exactTimeText = Array.isArray(q.exactTimeText) ? q.exactTimeText[0] : String(q.exactTimeText || "");
  const startTimeUtc  = Array.isArray(q.startTimeUtc)  ? q.startTimeUtc[0]  : String(q.startTimeUtc  || "");
  const leadTimeZone  = Array.isArray(q.leadTimeZone)  ? q.leadTimeZone[0]  : String(q.leadTimeZone  || "");
  const agentTimeZone = Array.isArray(q.agentTimeZone) ? q.agentTimeZone[0] : String(q.agentTimeZone || "");
  const userEmail     = Array.isArray(q.userEmail)     ? q.userEmail[0]     : String(q.userEmail     || "");
  const agentName     = Array.isArray(q.agentName)     ? q.agentName[0]     : String(q.agentName     || "");
  const leadName      = Array.isArray(q.leadName)      ? q.leadName[0]      : String(q.leadName      || "");

  if (!key || key !== AI_DIALER_CRON_KEY) {
    return res.status(401).send("Unauthorized");
  }

  const agentFirst = (agentName || "our agent").split(" ")[0] || "our agent";
  const safeAgentFirst = xmlEscape(agentFirst);

  // Twilio sends DialCallStatus as form-encoded body
  const body = req.body as Record<string, string> | undefined;
  const dialCallStatus = (body?.DialCallStatus || "").toLowerCase();

  res.setHeader("Content-Type", "text/xml");

  try {
    if (dialCallStatus === "completed") {
      try {
        const agentEmailTo = String(req.query.userEmail || req.body?.userEmail || "");
        if (agentEmailTo) {
          const leadFields: [string, string][] = [
            ["Lead Name", String(req.query.leadName || "")],
            ["Phone", String(req.body?.Called || req.body?.From || "")],
            ["Agent", String(req.query.agentName || "")],
            ["Scope", String(req.query.scope || "")],
            ["Lead ID", String(req.query.leadId || "")],
            ["Transfer Time", new Date().toLocaleString("en-US", { timeZone: String(req.query.agentTimeZone || "America/New_York") })],
          ];
          const rows = leadFields
            .filter(([, v]) => v)
            .map(([k, v]) => `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;color:#555;width:160px">${k}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#222">${v}</td></tr>`)
            .join("");
          const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#1a1a1a">Live Transfer Connected ✅</h2>
        <p style="color:#555">A lead was just live transferred to you. Here are their details:</p>
        <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">${rows}</table>
        <p style="color:#888;font-size:12px;margin-top:16px">Sent automatically by CoveCRM after a successful live transfer.</p>
      </div>`;
          await sendEmail(agentEmailTo, "Live Transfer Connected — Lead Details", html);
        }
      } catch (e) {
        console.error("[TRANSFER-FALLBACK] Failed to send agent email", e);
      }

      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural" rate="90%">Thank you for your time. Have a great day!</Say>
  <Hangup/>
</Response>`);
    }

    // Agent didn't answer — try to auto-book if we have a startTimeUtc
    let booked = false;

    if (startTimeUtc && startTimeUtc.trim()) {
      try {
        const bookUrl = new URL("/api/ai-calls/book-appointment", COVECRM_BASE_URL);
        bookUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
        const bookRes = await fetch(bookUrl.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ai-dialer-key": AI_DIALER_CRON_KEY,
          },
          body: JSON.stringify({
            aiCallSessionId: sessionId,
            leadId,
            startTimeUtc,
            durationMinutes: 30,
            leadTimeZone,
            agentTimeZone,
            source: "live-transfer-fallback",
          }),
        });
        const bookJson = await bookRes.json();
        if (bookJson.ok === true) {
          booked = true;
          await fetch(new URL("/api/ai-calls/outcome", COVECRM_BASE_URL).toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-agent-key": AI_DIALER_AGENT_KEY,
            },
            body: JSON.stringify({
              callSid,
              outcome: "booked",
              confirmedYes: true,
              repeatBackConfirmed: true,
              summary: "Booked via live transfer fallback — agent did not answer.",
              dispositionRule: "move_to_booked",
            }),
          });
        }
      } catch (err) {
        console.error("[TRANSFER-FALLBACK] Booking error:", err);
      }
    }

    if (booked) {
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural" rate="90%">${safeAgentFirst} wasn't available right now, but we've got your appointment scheduled. They'll reach out at the time we discussed. Have a great day!</Say>
  <Hangup/>
</Response>`);
    }

    const rebootUrl = new URL("/api/ai-calls/transfer-reboot-twiml", COVECRM_BASE_URL);
    rebootUrl.searchParams.set("key", AI_DIALER_CRON_KEY);
    rebootUrl.searchParams.set("leadId", leadId);
    rebootUrl.searchParams.set("leadName", leadName);
    rebootUrl.searchParams.set("agentName", agentName);
    rebootUrl.searchParams.set("userEmail", userEmail);
    rebootUrl.searchParams.set("sessionId", sessionId);
    rebootUrl.searchParams.set("callSid", callSid);
    rebootUrl.searchParams.set("agentTimeZone", agentTimeZone || "America/New_York");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${xmlEscape(rebootUrl.toString())}</Redirect>
</Response>`);
  } catch (err) {
    console.error("[TRANSFER-FALLBACK] Uncaught error:", err);
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna-Neural" rate="90%">Sorry, we'll have someone reach out to you soon.</Say>
  <Hangup/>
</Response>`);
  }
}

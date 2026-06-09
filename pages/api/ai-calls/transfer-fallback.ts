// pages/api/ai-calls/transfer-fallback.ts
// Called by Twilio if the agent doesn't answer on live transfer.
// Attempts to book the appointment automatically, then says an appropriate message.
import type { NextApiRequest, NextApiResponse } from "next";
import { sendEmail } from "@/lib/email";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";

const AI_DIALER_CRON_KEY = process.env.AI_DIALER_CRON_KEY || "";
const AI_DIALER_AGENT_KEY = process.env.AI_DIALER_AGENT_KEY || "";
const COVECRM_BASE_URL = process.env.COVECRM_BASE_URL || "https://www.covecrm.com";
const AI_VOICE_WSS_URL = process.env.AI_VOICE_WSS_URL || process.env.AI_VOICE_STREAM_URL || "";
const amdRebootedLeadCalls = new Map<string, number>();
const AMD_REBOOTED_TTL_MS = 5 * 60 * 1000;

function xmlEscape(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function markAmdRebooted(callSid: string) {
  if (!callSid) return;
  const now = Date.now();
  amdRebootedLeadCalls.set(callSid, now + AMD_REBOOTED_TTL_MS);
}

function hasAmdRebooted(callSid: string) {
  if (!callSid) return false;
  const expiresAt = amdRebootedLeadCalls.get(callSid) || 0;
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    amdRebootedLeadCalls.delete(callSid);
    return false;
  }
  return true;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const q = req.query;
  const body = req.body as Record<string, string> | undefined;
  const key           = Array.isArray(q.key)           ? q.key[0]           : String(q.key           || "");
  const sessionId     = Array.isArray(q.sessionId)     ? q.sessionId[0]     : String(q.sessionId     || "");
  const leadId        = Array.isArray(q.leadId)        ? q.leadId[0]        : String(q.leadId        || "");
  const callSid       = Array.isArray(q.callSid)       ? q.callSid[0]       : String(q.callSid       || "");
  const leadCallSid   = Array.isArray(q.leadCallSid)   ? q.leadCallSid[0]   : String(q.leadCallSid   || "");
  const conferenceName = Array.isArray(q.conferenceName) ? q.conferenceName[0] : String(q.conferenceName || "");
  const exactTimeText = Array.isArray(q.exactTimeText) ? q.exactTimeText[0] : String(q.exactTimeText || "");
  const startTimeUtc  = Array.isArray(q.startTimeUtc)  ? q.startTimeUtc[0]  : String(q.startTimeUtc  || "");
  const leadTimeZone  = Array.isArray(q.leadTimeZone)  ? q.leadTimeZone[0]  : String(q.leadTimeZone  || "");
  const agentTimeZone = Array.isArray(q.agentTimeZone) ? q.agentTimeZone[0] : String(q.agentTimeZone || "");
  const userEmail     = Array.isArray(q.userEmail)     ? q.userEmail[0]     : String(q.userEmail     || "");
  const agentName     = Array.isArray(q.agentName)     ? q.agentName[0]     : String(q.agentName     || "");
  const leadName      = Array.isArray(q.leadName)      ? q.leadName[0]      : String(q.leadName      || "");
  const amdRebooted = String(q.amdRebooted || body?.amdRebooted || "").toLowerCase() === "true";
  const coverageSubject = Array.isArray(q.coverageSubject) ? q.coverageSubject[0] : String(q.coverageSubject || "");
  const selectedDay     = Array.isArray(q.selectedDay)     ? q.selectedDay[0]     : String(q.selectedDay     || "");

  if (!key || key !== AI_DIALER_CRON_KEY) {
    return res.status(401).send("Unauthorized");
  }

  if (amdRebooted && leadCallSid) {
    markAmdRebooted(leadCallSid);
    console.log("[TRANSFER-FALLBACK] marked AMD rebooted lead", {
      leadCallSid,
      conferenceName,
    });
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
  }

  // Fresh DB check — works across serverless instances, unlike the in-memory map.
  // agent-amd-callback writes transferRebootPending=true before redirecting the lead.
  // If it's set, hold the lead alive with <Pause> instead of re-redirecting.
  try {
    await mongooseConnect();
    const recording = await AICallRecording.findOne({ callSid: leadCallSid || callSid }).lean();
    const isRebootPending = !!(recording as any)?.transferRebootPending;

    if (isRebootPending) {
      const wsUrl = AI_VOICE_WSS_URL;
      if (!wsUrl) {
        console.error("[TRANSFER-FALLBACK] AI_VOICE_WSS_URL not configured — hanging up");
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      }
      console.log("[TRANSFER-FALLBACK] transferRebootPending in DB — returning Connect/Stream for reboot", {
        leadCallSid: leadCallSid || callSid,
      });
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${xmlEscape(wsUrl)}">
      <Parameter name="sessionId" value="${xmlEscape(sessionId)}"/>
      <Parameter name="leadId" value="${xmlEscape(leadId)}"/>
      <Parameter name="rebookingMode" value="true"/>
      <Parameter name="leadName" value="${xmlEscape(leadName)}"/>
      <Parameter name="agentName" value="${xmlEscape(agentName)}"/>
      <Parameter name="userEmail" value="${xmlEscape(userEmail)}"/>
      <Parameter name="callSid" value="${xmlEscape(leadCallSid || callSid)}"/>
      <Parameter name="agentTimeZone" value="${xmlEscape(agentTimeZone || "America/New_York")}"/>
      <Parameter name="callDirection" value="outbound"/>
    </Stream>
  </Connect>
</Response>`);
    }
  } catch (dbErr) {
    console.warn("[TRANSFER-FALLBACK] DB check for transferRebootPending failed (non-blocking)", dbErr);
  }

  const agentFirst = (agentName || "our agent").split(" ")[0] || "our agent";
  const safeAgentFirst = xmlEscape(agentFirst);

  // Twilio sends DialCallStatus as form-encoded body
  const dialCallStatus = (body?.DialCallStatus || "").toLowerCase();
  const dialCallDuration = parseInt(String(body?.DialCallDuration || "0"), 10);
  const answeredBy = String(body?.AnsweredBy || "").toLowerCase();
  const wasVoicemail = answeredBy.includes("machine") || (dialCallStatus === "completed" && dialCallDuration < 25);

  res.setHeader("Content-Type", "text/xml");

  try {
    if (dialCallStatus === "completed" && dialCallDuration > 25 && !wasVoicemail) {
      try {
        const agentEmailTo = String(req.query.userEmail || req.body?.userEmail || "");
        if (agentEmailTo) {
          // Enrich with DB lead data
          let dbLead: any = null;
          try {
            if (leadId) dbLead = await Lead.findById(leadId).lean();
          } catch { /* non-blocking */ }

          const rawRow = dbLead?.rawRow || {};
          const getAddr = (keys: string[]) => { for (const k of keys) { const v = rawRow[k]; if (v && String(v).trim()) return String(v).trim(); } return ""; };
          const address = getAddr(["Address", "address", "Street", "street"]);
          const city    = getAddr(["City", "city"]);
          const zip     = getAddr(["Zip", "zip", "ZipCode", "zipcode"]);
          const addrLine = [address, city, zip].filter(Boolean).join(", ");

          const dbLeadType = String(dbLead?.leadType || req.query.scope || "").trim();
          const dbState    = String(dbLead?.State || "").trim();
          const dbAge      = String(dbLead?.Age || "").trim();
          const dbEmail    = String(dbLead?.email || dbLead?.Email || "").trim();
          const dbCoverage = String((dbLead as any)?.["Coverage Amount"] || "").trim();

          const formatCoverageSubject = (raw: string, name: string): string => {
            const t = raw.toLowerCase().trim();
            if (!t) return "";
            if (t === "just me" || t === "myself" || t === "just myself") return "Just themselves";
            if (t === "me and my spouse" || t === "both" || t === "spouse" || t === "me and spouse") return `${name} and spouse`;
            if (t.includes("girlfriend") || t.includes("partner") || t.includes("significant other")) return `${name} and partner`;
            return raw;
          };
          const displayLeadName = String(req.query.leadName || "").trim();
          const coverageFor = formatCoverageSubject(coverageSubject, displayLeadName);

          const transferTime = new Date().toLocaleString("en-US", { timeZone: String(req.query.agentTimeZone || "America/New_York") });
          const phone = String(req.body?.Called || req.body?.From || "").trim();

          const row = (label: string, value: string) =>
            value ? `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;color:#555;width:160px">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#222">${value}</td></tr>` : "";

          const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#1a1a1a">Live Transfer Connected &#x2705;</h2>
  <p style="color:#555">A lead was just live transferred to you. Here are their details:</p>

  <p style="font-weight:700;color:#333;margin:16px 0 4px">LEAD INFO</p>
  <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
    ${row("Name", displayLeadName)}
    ${row("Phone", phone)}
    ${row("Email", dbEmail)}
    ${row("Address", addrLine)}
    ${row("State", dbState)}
    ${row("Age", dbAge)}
  </table>

  <p style="font-weight:700;color:#333;margin:16px 0 4px">COVERAGE REQUEST</p>
  <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
    ${row("Lead Type", dbLeadType)}
    ${row("Coverage Amount", dbCoverage)}
    ${row("For", coverageFor)}
  </table>

  <p style="font-weight:700;color:#333;margin:16px 0 4px">APPOINTMENT</p>
  <table style="width:100%;border-collapse:collapse;background:#f9f9f9;border-radius:8px;overflow:hidden">
    ${row("Time", exactTimeText || selectedDay)}
    ${row("Agent", String(req.query.agentName || ""))}
    ${row("Transfer Time", transferTime)}
  </table>

  <p style="color:#888;font-size:12px;margin-top:16px">Sent automatically by CoveCRM after a successful live transfer.</p>
</div>`;
          await sendEmail(agentEmailTo, "Live Transfer Connected — Lead Details", html);
        }
      } catch (e) {
        console.error("[TRANSFER-FALLBACK] Failed to send agent email", e);
      }

      // Fire-and-forget: update lead status, optionally move to Live Transfers folder, record outcome
      if (leadId && userEmail) {
        const outcomeKey = process.env.AI_DIALER_AGENT_KEY || process.env.AI_DIALER_CRON_KEY || "";
        (async () => {
          try {
            const liveTransferFolder = await Folder.findOne({ userEmail, name: "Live Transfers" }).lean();
            const leadUpdate: Record<string, any> = { status: "Live Transfer", updatedAt: new Date() };
            if (liveTransferFolder) leadUpdate.folderId = (liveTransferFolder as any)._id;
            await Lead.updateOne({ _id: leadId }, { $set: leadUpdate });
            console.log("[TRANSFER-FALLBACK] lead status updated to Live Transfer", { leadId, movedFolder: !!liveTransferFolder });
          } catch (e) {
            console.error("[TRANSFER-FALLBACK] lead status update failed (non-blocking)", e);
          }
        })();
        if (outcomeKey && callSid) {
          fetch(new URL("/api/ai-calls/outcome", COVECRM_BASE_URL).toString(), {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-agent-key": outcomeKey },
            body: JSON.stringify({
              callSid,
              outcome: "transferred",
              confirmedYes: true,
              summary: "Live transfer completed successfully.",
              dispositionRule: "transferred",
            }),
          })
            .then((r) => { if (!r.ok) console.error("[TRANSFER-FALLBACK] outcome recording failed", r.status); })
            .catch((e) => console.error("[TRANSFER-FALLBACK] outcome recording error", e));
        }
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
          const outcomeKey = process.env.AI_DIALER_AGENT_KEY || process.env.AI_DIALER_CRON_KEY || "";
          const outcomeRes = await fetch(new URL("/api/ai-calls/outcome", COVECRM_BASE_URL).toString(), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-agent-key": outcomeKey,
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
          if (!outcomeRes.ok) {
            console.error("[TRANSFER] outcome recording failed", outcomeRes.status);
          }
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

    // Note: amdRebooted is always false here (handled above); hasAmdRebooted removed — DB check is
    // the authoritative gate now. This block is kept only in case amdRebooted arrives on this path.
    if (amdRebooted) {
      console.log("[TRANSFER-FALLBACK] amdRebooted flag set — returning pause to keep call alive", {
        leadCallSid,
      });
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="30"/>
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

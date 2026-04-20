// pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { trackUsage } from "@/lib/billing/trackUsage";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import Call from "@/models/Call";
import InboundCall from "@/models/InboundCall";
import Lead from "@/models/Lead";
import { sendEmail } from "@/lib/email";

const VOICE_COST_PER_MIN = Number(process.env.CRM_VOICE_COST_PER_MIN || 0.015);

/** Helpers */
function firstDefined<T = any>(...vals: T[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}
function toDate(v: any): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}
function toNumber(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : undefined;
}
function prune<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = prune(v as any);
      if (Object.keys(nested).length === 0) continue;
      out[k] = nested;
    } else out[k] = v;
  }
  return out as T;
}
function normStatus(s?: string) {
  const x = String(s || "").toLowerCase();
  // Treat "answered" as "in-progress"
  if (x === "answered") return "in-progress";
  return x;
}

function ceilMinutesFromSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.ceil(seconds / 60);
}

function escapeHtml(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pickFirst(obj: any, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function buildLeadName(lead: any): string | undefined {
  const first = pickFirst(lead, ["firstName", "First Name", "FirstName", "first_name", "name", "Name"]);
  const last = pickFirst(lead, ["lastName", "Last Name", "LastName", "last_name", "surname"]);
  if (first && last) return `${first} ${last}`.trim();
  if (first) return first;
  if (typeof lead?.email === "string" && lead.email) return lead.email.split("@")[0];
  return undefined;
}

async function sendMissedInboundCallEmailOnce(opts: {
  callSid: string;
  status: string;
  ownerEmail?: string;
  from?: string;
  leadId?: string;
}) {
  const missedStates = new Set(["busy", "failed", "no-answer", "canceled"]);
  if (!missedStates.has(opts.status) || !opts.callSid) return;

  const inbound = await (InboundCall as any).findOneAndUpdate(
    { callSid: opts.callSid, missedEmailSentAt: { $exists: false } },
    { $set: { missedEmailSentAt: new Date(), state: "expired" } },
    { new: false },
  ).lean();
  if (!inbound) return;

  const ownerEmail = String(inbound?.ownerEmail || opts.ownerEmail || "").toLowerCase();
  if (!ownerEmail) return;

  const leadId = inbound?.leadId ? String(inbound.leadId) : opts.leadId || "";
  let leadName = typeof inbound?.leadName === "string" ? inbound.leadName.trim() : "";
  if (!leadName && leadId) {
    try {
      const lead = await (Lead as any).findById(leadId).lean();
      leadName = buildLeadName(lead) || "";
    } catch {}
  }

  const phone = String(inbound?.from || opts.from || "").trim();
  const base = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
  const leadUrl = leadId ? `${base}/leads?open=${encodeURIComponent(leadId)}` : `${base}/leads`;
  const displayName = leadName || "Unknown caller";

  await sendEmail(
    ownerEmail,
    `Missed call from ${displayName}`,
    `
      <div style="font-family: Arial, sans-serif; line-height: 1.4;">
        <h3 style="margin:0 0 8px 0;">Missed call</h3>
        <p style="margin:0 0 8px 0;"><b>Client:</b> ${escapeHtml(displayName)}</p>
        ${phone ? `<p style="margin:0 0 8px 0;"><b>Phone:</b> ${escapeHtml(phone)}</p>` : ""}
        <p style="margin:0 0 8px 0;"><b>Status:</b> ${escapeHtml(opts.status)}</p>
        <p style="margin:0 0 8px 0;"><a href="${leadUrl}">Open lead</a></p>
      </div>
    `,
  );
}



/** Twilio recording URL is often returned as .json; convert to a playable asset URL */
function normalizeRecordingUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;

  // If Twilio gives a JSON resource URL, convert to mp3
  // Examples:
  //  - https://api.twilio.com/2010-04-01/Accounts/.../Recordings/RE... -> append .mp3
  //  - https://api.twilio.com/.../Recordings/RE....json -> replace with .mp3
  const hasQuery = s.includes("?");
  const [base, query] = hasQuery ? s.split("?", 2) : [s, ""];
  const lower = base.toLowerCase();

  let outBase = base;

  if (lower.endsWith(".json")) {
    outBase = base.slice(0, -5) + ".mp3";
  } else if (
    !lower.endsWith(".mp3") &&
    !lower.endsWith(".wav") &&
    !lower.endsWith(".m4a") &&
    !lower.endsWith(".aac")
  ) {
    // If it has no known extension, Twilio usually supports .mp3
    outBase = base + ".mp3";
  }

  return query ? `${outBase}?${query}` : outBase;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "PUT") {
    return res.status(200).json({ ok: false, ignored: true, reason: "method" });
  }

  await dbConnect();

  const b = req.body || {};
  const q = req.query || {};

  const callSid = String(firstDefined(b.callSid, b.CallSid, q.callSid, q.CallSid) || "").trim();
  if (!callSid) return res.status(200).json({ ok: false, error: "missing_callSid" });

  const status = normStatus(firstDefined(b.status, b.CallStatus, b.DialCallStatus, q.status, q.CallStatus, q.DialCallStatus));
  const rawDirection = String(firstDefined(b.direction, b.Direction, q.direction, q.Direction) || "").toLowerCase();
  const direction: "outbound" | "inbound" = rawDirection === "inbound" ? "inbound" : "outbound";

  const from = firstDefined(b.from, b.From, q.from, q.From) as string | undefined;
  const to = firstDefined(b.to, b.To, q.to, q.To) as string | undefined;

  const answeredBy = firstDefined(b.answeredBy, b.AnsweredBy, q.answeredBy, q.AnsweredBy) as string | undefined;
  const isVoicemail = typeof answeredBy === "string" ? /machine/i.test(answeredBy) : undefined;

  // Twilio duration field; accept JSON "duration" too
  const duration = toNumber(firstDefined(b.duration, b.Duration, b.CallDuration, q.duration, q.CallDuration));
  const talkTime = toNumber(firstDefined(b.talkTime, q.talkTime)); // optional override

  const startedAt = toDate(firstDefined(b.startTime, b.StartTime));
  const completedAt = toDate(firstDefined(b.endTime, b.EndTime));

  const userEmailParam =
    typeof b.userEmail === "string"
      ? b.userEmail.toLowerCase()
      : typeof q.userEmail === "string"
      ? String(q.userEmail).toLowerCase()
      : undefined;

  // ✅ Recording fields (Twilio Recording Status Callback / Recording events)
  const recordingSid = firstDefined(
    b.recordingSid,
    b.RecordingSid,
    q.recordingSid,
    q.RecordingSid,
  ) as string | undefined;

  const recordingUrlRaw = firstDefined(
    b.recordingUrl,
    b.RecordingUrl,
    q.recordingUrl,
    q.RecordingUrl,
  ) as string | undefined;

  const recordingUrl = normalizeRecordingUrl(recordingUrlRaw);

  const recordingStatus = firstDefined(
    b.recordingStatus,
    b.RecordingStatus,
    q.recordingStatus,
    q.RecordingStatus,
  ) as string | undefined;

  const recordingDuration = toNumber(
    firstDefined(
      b.recordingDuration,
      b.RecordingDuration,
      q.recordingDuration,
      q.RecordingDuration,
    ),
  );

  const hasRecording = Boolean(recordingSid || recordingUrl);

  // 🔎 Pull any inbound metadata (ownerEmail + leadId) for this callSid
  let inboundOwnerEmail: string | undefined;
  let inboundLeadId: string | undefined;
  try {
    const inbound = await (InboundCall as any).findOne({ callSid }).lean();
    if (inbound) {
      if (inbound.ownerEmail) inboundOwnerEmail = String(inbound.ownerEmail).toLowerCase();
      if (inbound.leadId) inboundLeadId = String(inbound.leadId);
    }
  } catch (e) {
    console.error("[voice-status] inbound lookup error", e);
  }

  // Load existing to preserve attribution
  const existing = await (Call as any).findOne({ callSid }).lean();

  // ✅ GHL-style billing window
  // Start billing when call starts truly 'ringing' (or in-progress if ringing never arrives)
  const wantStartBill = (status === "ringing" || status === "in-progress") && !existing?.billStartAt;
  const wantMarkRinging = status === "ringing" && !existing?.ringingAt;
  const terminalForBilling = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);
  const wantStopBill = terminalForBilling && !existing?.billStopAt;

  const userEmail = (existing?.userEmail || userEmailParam || inboundOwnerEmail || "").toLowerCase();
  const effDirection: "outbound" | "inbound" = (existing?.direction || direction) as any;
  const leadId = existing?.leadId ? String(existing.leadId) : inboundLeadId;

  // If we’d have to insert but still lack userEmail, skip insert (prevent orphan rows)
  const allowInsert = Boolean(userEmail);
  const isNewDoc = !existing;

  const now = new Date();

  // ✅ Only include NON-overlapping fields in $setOnInsert
  const setOnInsert = prune({
    callSid,
    userEmail: userEmail || undefined,
    direction: effDirection,
    leadId: leadId || undefined,
    createdAt: now,
    kind: "call",
  });

  // ✅ All mutable/current fields go in $set
  const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);

  const set = prune({
    status,

    ...(wantMarkRinging ? { ringingAt: existing?.ringingAt || now } : {}),
    ...(wantStartBill ? { billStartAt: existing?.billStartAt || now } : {}),
    ...(wantStopBill ? { billStopAt: existing?.billStopAt || now } : {}),

    // keep latest numbers (do NOT duplicate in $setOnInsert)
    ownerNumber: existing?.ownerNumber || from,
    otherNumber: existing?.otherNumber || to,
    from,
    to,

    ...(status === "ringing" || status === "in-progress"
      ? { startedAt: existing?.startedAt || startedAt || now }
      : {}),

    ...(terminal
      ? {
          completedAt: existing?.completedAt || completedAt || now,
          endedAt: existing?.endedAt || completedAt || now,
        }
      : {}),

    duration: duration,
    durationSec: duration,
    talkTime: toNumber(firstDefined(talkTime, duration)),

    amd: answeredBy ? { answeredBy } : undefined,
    isVoicemail,
    updatedAt: now,

    // If we learned a leadId from InboundCall and the Call doc doesn't have one yet, attach it
    ...(leadId && !existing?.leadId ? { leadId } : {}),

    // ✅ Recording persistence (this is the missing piece)
    ...(recordingSid ? { recordingSid } : {}),
    ...(recordingUrl ? { recordingUrl } : {}),
    ...(recordingStatus ? { recordingStatus } : {}),
    ...(recordingDuration !== undefined ? { recordingDuration } : {}),
    ...(hasRecording ? { hasRecording: true } : {}),
  });

  try {
    if (isNewDoc && !allowInsert) {
      await (Call as any).updateOne({ callSid }, { $set: set }, { upsert: false });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        ok: true,
        callSid,
        status,
        hadUserEmail: false,
        note: "skipped_insert_without_userEmail",
      });
    }

    await (Call as any).updateOne({ callSid }, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });

    if (effDirection === "inbound" && terminalForBilling) {
      try {
        await sendMissedInboundCallEmailOnce({
          callSid,
          status,
          ownerEmail: userEmail,
          from,
          leadId,
        });
      } catch (e: any) {
        console.warn("[voice-status] missed-call email failed", e?.message || e);
      }
    }

    // ✅ Finalize billing once, when terminal status arrives
    // Idempotent: only bill if billedAt is not set
    if (terminalForBilling) {
      try {
        const updated = await (Call as any).findOne({ callSid }).lean();
        if (updated && !updated?.billedAt && updated?.billStartAt) {
          const start = new Date(updated.billStartAt).getTime();
          const stop = new Date(updated.billStopAt || now).getTime();
          const seconds = Math.max(0, (stop - start) / 1000);
          const mins = ceilMinutesFromSeconds(seconds);

          if (mins > 0) {
            const uEmail = String(updated.userEmail || "").toLowerCase();
            if (uEmail) {
              const user = await (User as any).findOne({ email: uEmail });
              if (user) {
                const { usingPersonal } = await getClientForUser(user.email);
                if (!usingPersonal) {
                  await trackUsage({ user, amount: mins * VOICE_COST_PER_MIN, source: "twilio-voice" });
                  await (Call as any).updateOne({ callSid, billedAt: { $exists: false } }, { $set: { billedAt: now } });
                }
              }
            }
          }
        }
      } catch (e) {
        console.error("[voice-status] billing finalize error", (e as any)?.message || e);
      }
    }

    console.log(
      `[voice-status] callSid=${callSid} status=${status} hadUserEmail=${Boolean(
        userEmail,
      )} leadId=${leadId || existing?.leadId || ""} hasRecording=${hasRecording}`,
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, callSid, status, hadUserEmail: Boolean(userEmail) });
  } catch (err: any) {
    console.error("[voice-status] upsert error", err?.message || err);
    return res.status(200).json({ ok: false, error: "upsert_failed" });
  }
}

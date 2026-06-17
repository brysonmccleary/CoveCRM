// pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { trackUsage } from "@/lib/billing/trackUsage";
import Call from "@/models/Call";
import InboundCall from "@/models/InboundCall";
import Lead from "@/models/Lead";
import { sendEmail } from "@/lib/email";

const VOICE_COST_PER_MIN = Number(process.env.CRM_VOICE_COST_PER_MIN || 0.015);
const MANUAL_VOICE_COST_PER_MIN = Number(process.env.MANUAL_VOICE_COST_PER_MIN || "0.02");
const MIN_MANUAL_BILLABLE_SECONDS = 5;
const NEVER_BILL_EMAILS = new Set(["bryson.mccleary1@gmail.com", "support@covecrm.com"]);
const BILLING_IN_PROGRESS_SOURCES = [
  "manual_dial_billing_in_progress",
  "twilio_voice_billing_in_progress",
];

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

function rawStatus(s?: string) {
  return String(s || "").toLowerCase();
}

function manualBillStartSource(status: string) {
  if (status === "initiated") return "pstn_initiated";
  if (status === "ringing") return "pstn_ringing";
  if (status === "in-progress" || status === "answered") return "pstn_answered";
  return undefined;
}

function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

function isNeverBillEmail(email?: string | null) {
  if (!email) return false;
  const normalized = email.toLowerCase();
  return NEVER_BILL_EMAILS.has(normalized) || isAdminEmail(normalized);
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

  const rawCallStatus = rawStatus(firstDefined(b.status, b.CallStatus, q.status, q.CallStatus));
  const rawDialCallStatus = rawStatus(firstDefined(b.DialCallStatus, q.DialCallStatus));
  const status = normStatus(firstDefined(b.status, b.CallStatus, b.DialCallStatus, q.status, q.CallStatus, q.DialCallStatus));
  const rawDirection = String(firstDefined(b.direction, b.Direction, q.direction, q.Direction) || "").toLowerCase();
  const direction: "outbound" | "inbound" = rawDirection === "inbound" ? "inbound" : "outbound";
  const billingCategory = String(firstDefined(b.billingCategory, q.billingCategory) || "").toLowerCase();
  const legType = String(firstDefined(b.legType, q.legType) || "").toLowerCase();
  const parentCallSid = String(firstDefined(b.parentCallSid, b.ParentCallSid, q.parentCallSid, q.ParentCallSid) || "").trim();
  const dialCallSid = String(firstDefined(b.dialCallSid, b.DialCallSid, q.dialCallSid, q.DialCallSid) || "").trim();
  const isManualPstnLeg = billingCategory === "manual_dial" && legType === "pstn";

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
  const manualAttemptStatus = rawCallStatus || rawDialCallStatus || status;
  const wantManualStartBill =
    isManualPstnLeg &&
    ["initiated", "ringing", "in-progress", "answered"].includes(manualAttemptStatus) &&
    !existing?.billStartAt;
  const wantStartBill = !isManualPstnLeg && (status === "ringing" || status === "in-progress") && !existing?.billStartAt;
  const wantMarkRinging = status === "ringing" && !existing?.ringingAt;
  const terminalForBilling = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);
  const wantStopBill = terminalForBilling && !existing?.billStopAt;

  const userEmail = (existing?.userEmail || userEmailParam || inboundOwnerEmail || "").toLowerCase();
  const effDirection: "outbound" | "inbound" = (existing?.direction || direction) as any;
  const qLeadId = typeof q.leadId === "string" ? q.leadId.trim() : undefined;
  const leadId = existing?.leadId ? String(existing.leadId) : (inboundLeadId || qLeadId);

  // If we’d have to insert but still lack userEmail, skip insert (prevent orphan rows)
  const allowInsert = Boolean(userEmail);
  const isNewDoc = !existing;

  const now = new Date();
  const firstManualPstnCallbackAt =
    isManualPstnLeg
      ? existing?.firstManualPstnCallbackAt || existing?.createdAt || now
      : undefined;
  const terminalOnlyManualFallbackStart =
    isManualPstnLeg &&
    terminalForBilling &&
    !existing?.billStartAt &&
    Boolean(existing?.firstManualPstnCallbackAt || existing?.createdAt)
      ? firstManualPstnCallbackAt
      : undefined;

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
    ...(wantManualStartBill || wantStartBill || terminalOnlyManualFallbackStart
      ? { billStartAt: existing?.billStartAt || terminalOnlyManualFallbackStart || now }
      : {}),
    ...(wantManualStartBill
      ? { billStartSource: existing?.billStartSource || manualBillStartSource(manualAttemptStatus) }
      : {}),
    ...(terminalOnlyManualFallbackStart
      ? { billStartSource: existing?.billStartSource || "first_manual_pstn_callback" }
      : {}),
    ...(wantStopBill ? { billStopAt: existing?.billStopAt || now } : {}),
    ...(isManualPstnLeg && terminalForBilling ? { billStopSource: existing?.billStopSource || "pstn_terminal" } : {}),
    ...(isManualPstnLeg
      ? {
          billingCategory,
          legType,
          pstnCallSid: existing?.pstnCallSid || callSid,
          firstManualPstnCallbackAt,
        }
      : {}),
    ...(isManualPstnLeg && parentCallSid ? { parentCallSid } : {}),
    ...(isManualPstnLeg && dialCallSid ? { dialCallSid } : {}),

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
        if (updated && !updated?.billedAt) {
          const updatedBillingCategory = String(updated.billingCategory || billingCategory || "").toLowerCase();
          const updatedLegType = String(updated.legType || legType || "").toLowerCase();
          const shouldUseManualBilling =
            updatedBillingCategory === "manual_dial" &&
            updatedLegType === "pstn" &&
            Boolean(updated.userEmail);
          const shouldUseManualVoiceRate =
            shouldUseManualBilling || updated.direction === "inbound" || updated.direction === "outbound";
          const ratePerMinute = shouldUseManualVoiceRate ? MANUAL_VOICE_COST_PER_MIN : VOICE_COST_PER_MIN;

          let seconds = 0;
          if (updated.billStartAt) {
            const start = new Date(updated.billStartAt).getTime();
            const stop = new Date(updated.billStopAt || now).getTime();
            seconds = Math.max(0, (stop - start) / 1000);
          } else if ((updated.durationSec || 0) > 0) {
            seconds = updated.durationSec;
          } else if ((updated.duration || 0) > 0) {
            seconds = updated.duration;
          }
          const twilioDuration = Math.max(0, Number(updated.durationSec || updated.duration || duration || 0));

          if (shouldUseManualBilling && seconds < MIN_MANUAL_BILLABLE_SECONDS && twilioDuration <= 0) {
            await (Call as any).updateOne(
              {
                callSid,
                $or: [{ billedAt: { $exists: false } }, { billedAt: null }],
              },
              {
                $set: {
                  billedAt: now,
                  billableSeconds: 0,
                  billedMinutes: 0,
                  billedAmount: 0,
                  billingRatePerMinute: ratePerMinute,
                  billedSource: "manual_dial_ring_elapsed",
                },
              },
            );
            throw new Error("__manual_zero_billed__");
          }

          const mins = ceilMinutesFromSeconds(seconds);

          if (mins > 0) {
            const uEmail = String(updated.userEmail || "").toLowerCase();
            if (uEmail) {
              const user = await (User as any).findOne({ email: uEmail });
              if (user) {
                // Check billingMode directly instead of calling getClientForUser.
                // getClientForUser makes live Twilio API calls (credential validation,
                // key rotation) that can throw and silently kill this entire billing block.
                // Self-billed users (billingMode:"self") have their own Twilio account;
                // Twilio charges them directly so we must not add a second charge here.
                const usingPersonal = String(user.billingMode || "").toLowerCase() === "self";
                const isAdminRole = String((user as any).role || "").toLowerCase() === "admin";
                const isExempt = usingPersonal || isAdminRole || isNeverBillEmail(uEmail);
                const finalBilledSource = shouldUseManualBilling ? "manual_dial_ring_elapsed" : "twilio-voice";
                const inProgressSource = shouldUseManualBilling
                  ? "manual_dial_billing_in_progress"
                  : "twilio_voice_billing_in_progress";
                const billedAmount = isExempt ? 0 : mins * ratePerMinute;

                const lock = await (Call as any).updateOne(
                  {
                    callSid,
                    $and: [
                      { $or: [{ billedAt: { $exists: false } }, { billedAt: null }] },
                      {
                        $or: [
                          { billedSource: { $exists: false } },
                          { billedSource: null },
                          { billedSource: { $nin: BILLING_IN_PROGRESS_SOURCES } },
                        ],
                      },
                    ],
                  },
                  {
                    $set: {
                      billedSource: inProgressSource,
                      billedMinutes: mins,
                      billedAmount,
                      billableSeconds: seconds,
                      billingRatePerMinute: ratePerMinute,
                    },
                  },
                );

                if ((lock as any)?.modifiedCount === 0) {
                  console.log("[voice-status] billing lock already acquired", { callSid });
                } else {
                  try {
                    if (!isExempt) {
                      await trackUsage({
                        user,
                        amount: billedAmount,
                        source: "twilio-voice",
                      });
                    }

                    await (Call as any).updateOne(
                      { callSid, billedSource: inProgressSource },
                      {
                        $set: {
                          billedAt: now,
                          billedSource: finalBilledSource,
                        },
                      },
                    );
                  } catch (billingErr) {
                    await (Call as any).updateOne(
                      { callSid, billedSource: inProgressSource },
                      {
                        $unset: {
                          billedMinutes: "",
                          billedAmount: "",
                          billableSeconds: "",
                          billingRatePerMinute: "",
                          billedSource: "",
                        },
                      },
                    );
                    throw billingErr;
                  }
                }
              }
            }
          }
        }
      } catch (e) {
        if ((e as any)?.message !== "__manual_zero_billed__") {
          console.error("[voice-status] billing finalize error", (e as any)?.message || e);
        }
      }
    }

    // Auto-trigger AI transcription + overview for completed calls with a recording.
    // The transcribe-recording endpoint is idempotent (skips if already done).
    if (status === "completed" && recordingUrl && userEmail) {
      const baseUrl = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
      const cronKey = (process.env.AI_DIALER_CRON_KEY || "").trim();
      if (baseUrl && cronKey) {
        fetch(`${baseUrl}/api/calls/transcribe-recording`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-key": cronKey,
          },
          body: JSON.stringify({ callSid }),
        }).catch(() => {});
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

// pages/api/ai-calls/call-status-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import User from "@/models/User";
import Call from "@/models/Call";
import Lead from "@/models/Lead";
import { trackAiDialerUsage } from "@/lib/billing/trackAiDialerUsage";
import { Types } from "mongoose";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

export const config = { api: { bodyParser: false } };

// Your cost per **dial minute** (Twilio + OpenAI), for margin tracking only.
const VENDOR_RATE_PER_MINUTE = Number(
  process.env.AI_DIALER_VENDOR_RATE_PER_MIN_USD || "0.03"
);

// ✅ global hard kill switch (env)
const AI_DIALER_DISABLED =
  String(process.env.AI_DIALER_DISABLED || "").trim().toLowerCase() === "true";

// ✅ used to securely kick /api/ai-calls/worker
const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

// ✅ launch-safe voicemail fast-skip guard window (seconds)
// Prevents false positives ending real human calls during the first seconds.
const VOICEMAIL_FAST_SKIP_MIN_SECONDS = Number(
  process.env.AI_DIALER_VOICEMAIL_FAST_SKIP_MIN_SECONDS || "6"
);

function parseIntSafe(n?: string | null): number | undefined {
  if (!n) return undefined;
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : undefined;
}

function runtimeBase(req: NextApiRequest) {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

async function kickAiWorkerOnce(req: NextApiRequest, meta: any) {
  // Only kick if we have a secret configured to authorize the worker
  const secretToUse = CRON_SECRET || AI_DIALER_CRON_KEY;
  if (!secretToUse) {
    console.warn(
      "[AI Dialer] Not kicking worker: CRON_SECRET/AI_DIALER_CRON_KEY missing",
      meta
    );
    return;
  }

  const url = new URL("/api/ai-calls/worker", runtimeBase(req));
  // worker accepts bearer + headers + qs; bearer is cleanest
  try {
    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretToUse}`,
        "x-cron-secret": secretToUse,
        "x-cron-key": secretToUse,
      },
    });

    const text = await resp.text().catch(() => "");
    console.log("[AI Dialer] Kicked worker from call-status-webhook", {
      ...meta,
      workerStatus: resp.status,
      workerBody: text?.slice(0, 300),
    });
  } catch (err: any) {
    console.error("[AI Dialer] Failed to kick worker from call-status-webhook", {
      ...meta,
      error: err?.message || err,
    });
  }
}

function mapTerminalOutcome(callStatus: string, answeredByRaw: string) {
  const answeredBy = (answeredByRaw || "").toLowerCase();

  // Twilio AMD values can include: human, machine, fax, unknown, machine_start, machine_end_beep, etc.
  const looksLikeMachine =
    answeredBy.includes("machine") || answeredBy.includes("fax");

  if (looksLikeMachine) return "voicemail";

  switch ((callStatus || "").toLowerCase()) {
    case "completed":
      return "disconnected"; // completed + no explicit AI outcome => conservative terminal label
    case "busy":
    case "no-answer":
      return "no_answer";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return undefined;
  }
}

// ✅ Safer voicemail detection:
// - Do NOT treat "machine_start" as voicemail (common false positive).
// - Prefer "machine_end_beep"/"machine_end_silence"/etc (high confidence).
function parseAnsweredBy(answeredByRaw: string): {
  answeredBy: string;
  isMachineLike: boolean;
  isHighConfidenceVoicemail: boolean;
} {
  const answeredBy = (answeredByRaw || "").toLowerCase().trim();
  const isMachineLike = answeredBy.includes("machine") || answeredBy.includes("fax");

  const highConfidence =
    answeredBy === "machine" || // legacy
    answeredBy.includes("machine_end") || // machine_end_beep / machine_end_silence / machine_end_other
    answeredBy.includes("machine_end_beep") ||
    answeredBy.includes("machine_end_silence") ||
    answeredBy.includes("fax"); // treat fax as high confidence

  // Explicitly NOT high confidence (can be wrong early)
  const lowConfidence =
    answeredBy.includes("machine_start") ||
    answeredBy.includes("unknown") ||
    answeredBy.length === 0;

  return {
    answeredBy,
    isMachineLike,
    isHighConfidenceVoicemail: isMachineLike && highConfidence && !lowConfidence,
  };
}

async function hangupCallIfPossible(userEmail: string, callSid: string) {
  if (!userEmail || !callSid) return;
  try {
    const { client } = await getClientForUser(userEmail);
    // Ending the call is NOT touching audio streaming; it simply completes the call.
    await client.calls(callSid).update({ status: "completed" } as any);
    console.log("[AI Dialer] Hung up call after voicemail detection", {
      userEmail,
      callSid,
    });
  } catch (err: any) {
    console.warn("[AI Dialer] Failed to hang up call (non-blocking)", {
      userEmail,
      callSid,
      error: err?.message || err,
    });
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    res.status(405).end("Method Not Allowed");
    return;
  }

  // Twilio sends x-www-form-urlencoded
  const raw = await buffer(req);
  const bodyStr = raw.toString("utf8");
  const params = new URLSearchParams(bodyStr);

  await mongooseConnect();

  try {
    const CallSid = params.get("CallSid") || "";
    const CallStatus = (params.get("CallStatus") || "").toLowerCase();

    // Twilio sends Duration or CallDuration in seconds on completed calls
    const DurationStr =
      params.get("CallDuration") || params.get("Duration") || "";
    const durationSec = parseIntSafe(DurationStr);

    // AMD hint (if enabled on call creation)
    const AnsweredBy =
      params.get("AnsweredBy") || params.get("answered_by") || "";

    // Optional hints from statusCallback URL
    const qs = req.query as { userEmail?: string };
    let userEmail = (qs.userEmail || "").toString().toLowerCase() || "";

    // We want to progress the session on terminal statuses too (not just "completed")
    const TERMINAL_STATUSES = new Set([
      "completed",
      "busy",
      "no-answer",
      "failed",
      "canceled",
    ]);
    const isTerminal = TERMINAL_STATUSES.has(CallStatus);

    // ─────────────────────────────────────────────────────────────────────────────
    // ✅ Reliability foundation:
    // 1) Ensure there is ALWAYS an AICallRecording row for a real Twilio callSid
    // 2) Update minimal telemetry fields (status/duration/answeredBy)
    // NOTE: We DO NOT touch any audio transport or TwiML here.
    // ─────────────────────────────────────────────────────────────────────────────

    let recDoc: any = null;

    if (CallSid) {
      const now = new Date();

      const set: any = {
        lastTwilioStatus: CallStatus,
        updatedAt: now,
      };

      if (typeof durationSec === "number" && durationSec >= 0) {
        set.durationSec = durationSec;
      }

      if (AnsweredBy) {
        set.answeredBy = AnsweredBy;
      }

      // Map Twilio status to a simple outcome label for reporting
      // (does NOT override an existing explicit AI outcome unless it's unknown)
      const mappedForReporting = mapTerminalOutcome(CallStatus, AnsweredBy);
      if (mappedForReporting) {
        set.fallbackOutcomeFromStatus = mappedForReporting;
      }

      const setOnInsert: any = {
        callSid: CallSid,
        outcome: "unknown",
        createdAt: now,
      };

      // only set userEmail on insert if we actually have it (avoid overwriting real value)
      if (userEmail) {
        setOnInsert.userEmail = userEmail;
      }

      recDoc = await AICallRecording.findOneAndUpdate(
        { callSid: CallSid },
        {
          $setOnInsert: setOnInsert,
          $set: set,
        },
        { upsert: true, new: true }
      ).lean();

      // if userEmail wasn't on query, try to resolve it from the recording
      if (!userEmail && recDoc?.userEmail) {
        userEmail = String(recDoc.userEmail).toLowerCase();
      }

      // ✅ additional safety: if still missing, attempt to recover userEmail from session (if present)
      // This is ONLY a fallback and will never overwrite an existing recording.userEmail.
      if (!userEmail && recDoc?.aiCallSessionId) {
        try {
          const s = await AICallSession.findById(recDoc.aiCallSessionId).lean();
          const sessionEmail =
            (s as any)?.userEmail || (s as any)?.email || (s as any)?.ownerEmail;
          if (sessionEmail && typeof sessionEmail === "string") {
            userEmail = sessionEmail.toLowerCase();

            await AICallRecording.updateOne(
              {
                callSid: CallSid,
                $or: [
                  { userEmail: { $exists: false } },
                  { userEmail: null },
                  { userEmail: "" },
                ],
              },
              { $set: { userEmail, updatedAt: new Date() } }
            ).exec();
          }
        } catch (e: any) {
          console.warn(
            "[AI Dialer] Failed to recover userEmail from session (non-blocking)",
            e?.message || e
          );
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ✅ Voicemail fast-skip (LAUNCH-SAFE):
    // Only end the call if:
    // - AMD is HIGH CONFIDENCE (e.g., machine_end_beep / machine_end_silence / fax / legacy "machine")
    // - AND the call has been alive for at least VOICEMAIL_FAST_SKIP_MIN_SECONDS
    // This prevents false positives from ending real human calls early (common on machine_start).
    // ─────────────────────────────────────────────────────────────────────────────
    try {
      const { answeredBy, isMachineLike, isHighConfidenceVoicemail } =
        parseAnsweredBy(AnsweredBy);

      if (CallSid && isMachineLike && userEmail && recDoc && recDoc.aiCallSessionId) {
        const now = new Date();

        const createdAtMs = recDoc?.createdAt ? new Date(recDoc.createdAt).getTime() : now.getTime();
        const ageMs = Math.max(0, now.getTime() - createdAtMs);
        const ageSec = ageMs / 1000;

        const meetsAgeGuard =
          Number.isFinite(VOICEMAIL_FAST_SKIP_MIN_SECONDS) &&
          VOICEMAIL_FAST_SKIP_MIN_SECONDS > 0
            ? ageSec >= VOICEMAIL_FAST_SKIP_MIN_SECONDS
            : true;

        const shouldFastSkip = isHighConfidenceVoicemail && meetsAgeGuard && !isTerminal;

        if (!shouldFastSkip) {
          console.log("[AI Dialer] Voicemail fast-skip suppressed (guarded)", {
            callSid: CallSid,
            userEmail,
            callStatus: CallStatus,
            answeredBy,
            isHighConfidenceVoicemail,
            ageSec: Math.round(ageSec * 100) / 100,
            minSec: VOICEMAIL_FAST_SKIP_MIN_SECONDS,
            isTerminal,
          });
        } else {
          // One-time guard per callSid (Twilio may retry status callbacks)
          const handled = await AICallRecording.updateOne(
            {
              callSid: CallSid,
              $or: [
                { voicemailHandledAt: { $exists: false } },
                { voicemailHandledAt: null },
              ],
            },
            {
              $set: {
                voicemailHandledAt: now,
                updatedAt: now,
              },
            }
          ).exec();

          const firstHandle = ((handled as any)?.modifiedCount ?? 0) > 0;

          if (firstHandle) {
            // Set conservative voicemail outcome only if still unknown
            await AICallRecording.updateOne(
              {
                callSid: CallSid,
                $or: [
                  { outcome: { $exists: false } },
                  { outcome: null },
                  { outcome: "unknown" },
                ],
              },
              {
                $set: {
                  outcome: "voicemail",
                  outcomeSource: "amd_voicemail",
                  updatedAt: now,
                },
              }
            ).exec();

            // Append lead history + notes once
            if (recDoc.leadId) {
              const leadId = recDoc.leadId as Types.ObjectId;

              const historyEntry = {
                type: "ai_outcome_fallback",
                message: `🤖 AI Dialer voicemail detected (AMD): AnsweredBy=${AnsweredBy || "machine"}`,
                timestamp: now,
                userEmail,
                meta: {
                  source: "call-status-webhook",
                  callSid: CallSid,
                  outcome: "voicemail",
                  recordingId: recDoc._id,
                  answeredBy: AnsweredBy,
                },
              };

              const lead = await Lead.findOne({
                _id: leadId,
                $or: [
                  { userEmail: userEmail },
                  { ownerEmail: userEmail },
                  { user: userEmail },
                ],
              }).exec();

              if (lead) {
                const existingHistory: any[] = Array.isArray((lead as any).history)
                  ? (lead as any).history
                  : [];

                const alreadyHasEntry = existingHistory.some((h: any) => {
                  const meta = h?.meta || {};
                  return meta?.callSid === CallSid && meta?.source === "call-status-webhook";
                });

                if (!alreadyHasEntry) {
                  existingHistory.push(historyEntry);
                  (lead as any).history = existingHistory;
                }

                const appendLine = `[AI Dialer] Voicemail detected (AMD) • CallSid=${CallSid} • AnsweredBy=${AnsweredBy || "machine"}`;
                const existingNotes =
                  ((lead as any).notes as string | undefined) ||
                  ((lead as any).Notes as string | undefined) ||
                  "";

                const alreadyInNotes =
                  typeof existingNotes === "string" && existingNotes.includes(`CallSid=${CallSid}`);

                if (!alreadyInNotes) {
                  const combined =
                    existingNotes && existingNotes.trim().length > 0
                      ? `${existingNotes}\n${appendLine}`
                      : appendLine;
                  (lead as any).notes = combined;
                  (lead as any).Notes = combined;
                }

                (lead as any).updatedAt = now;
                await lead.save();
              }
            }

            // End call immediately (non-audio)
            await hangupCallIfPossible(userEmail, CallSid);

            // Chain next lead immediately (CallSid-level dedupe)
            if (!AI_DIALER_DISABLED) {
              const aiCallSessionId = recDoc.aiCallSessionId as Types.ObjectId;

              const sessionKick = await AICallSession.updateOne(
                {
                  _id: aiCallSessionId,
                  status: { $in: ["queued", "running"] },
                  $or: [
                    { chainKickCallSid: { $exists: false } },
                    { chainKickCallSid: null },
                    { chainKickCallSid: { $ne: CallSid } },
                  ],
                },
                {
                  $set: {
                    chainKickedAt: now,
                    chainKickCallSid: CallSid,
                    updatedAt: now,
                  },
                }
              ).exec();

              const kicked = ((sessionKick as any)?.modifiedCount ?? 0) > 0;

              if (kicked) {
                await kickAiWorkerOnce(req, {
                  reason: "amd_voicemail_fast_skip",
                  sessionId: String(aiCallSessionId),
                  callSid: CallSid,
                  callStatus: CallStatus,
                  answeredBy: AnsweredBy,
                });
              } else {
                console.log(
                  "[AI Dialer] Suppressed duplicate voicemail fast-skip kick (same CallSid)",
                  {
                    sessionId: String(aiCallSessionId),
                    callSid: CallSid,
                    answeredBy: AnsweredBy,
                  }
                );
              }
            }
          } else {
            console.log(
              "[AI Dialer] Suppressed duplicate voicemail handling (already voicemailHandledAt)",
              {
                callSid: CallSid,
                userEmail,
                answeredBy: AnsweredBy,
                callStatus: CallStatus,
              }
            );
          }
        }
      }
    } catch (amdErr: any) {
      console.warn(
        "⚠️ AI Dialer voicemail fast-skip failed (non-blocking):",
        amdErr?.message || amdErr
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ✅ Billing: bill ONLY on completed calls with positive duration AND only once.
    // We use an idempotency guard on AICallRecording.billedAt to prevent overcharging
    // from webhook retries. (No changes to audio logic.)
    // ─────────────────────────────────────────────────────────────────────────────
    if (CallSid && CallStatus === "completed" && durationSec && durationSec > 0) {
      if (!userEmail) {
        console.warn(
          "[AI Dialer billing] No userEmail resolved for CallSid",
          CallSid
        );
      } else {
        // Acquire a one-time billing lock (Twilio may retry callbacks)
        const billLock = await AICallRecording.updateOne(
          {
            callSid: CallSid,
            $or: [{ billedAt: { $exists: false } }, { billedAt: null }],
          },
          { $set: { billedAt: new Date() } }
        ).exec();

        const locked = ((billLock as any)?.modifiedCount ?? 0) > 0;

        if (!locked) {
          console.log(
            "[AI Dialer billing] Suppressed duplicate billing (already billedAt)",
            {
              callSid: CallSid,
              userEmail,
              durationSec,
            }
          );
        } else {
          const user = await User.findOne({ email: userEmail });
          if (!user) {
            console.warn(
              "[AI Dialer billing] User not found for email",
              userEmail,
              "CallSid",
              CallSid
            );
// Bill based on **dial time** (full call duration in seconds)
            const minutes = Math.max(1, Math.ceil(durationSec / 60));
            const vendorCostUsd =
              VENDOR_RATE_PER_MINUTE > 0 ? minutes * VENDOR_RATE_PER_MINUTE : 0;

            try {
              await trackAiDialerUsage({
                user,
                minutes,
                vendorCostUsd,
              });
            } catch (billErr) {
              console.error(
                "❌ AI Dialer billing error (non-blocking) in call-status-webhook:",
                (billErr as any)?.message || billErr
              );

              // If billing failed, release the lock so a future retry can bill correctly
              // (Still safe from runaway loops because Twilio retries are limited.)
              try {
                await AICallRecording.updateOne(
                  { callSid: CallSid, billedAt: { $ne: null } },
                  { $set: { billedAt: null } }
                ).exec();
              } catch {
                // swallow
              }
            }
          }
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // --- SYNC INTO Call MODEL FOR LEAD ACTIVITY PANEL (AI DIALER ONLY) ---
    // ─────────────────────────────────────────────────────────────────────────────
    try {
      if (CallSid && recDoc && recDoc.leadId) {
        const now = new Date();
        const startedAt =
          typeof durationSec === "number" && durationSec > 0
            ? new Date(now.getTime() - durationSec * 1000)
            : undefined;

        const callUpdate: any = {
          userEmail,
          leadId: recDoc.leadId,
          direction: "outbound",
          aiEnabledAtCallTime: true,
          completedAt: now,
          duration: durationSec,
          durationSec,
        };

        if (startedAt) {
          callUpdate.startedAt = startedAt;
        }

        if (recDoc.recordingUrl) {
          callUpdate.recordingUrl = recDoc.recordingUrl;
        }
        if (recDoc.recordingSid) {
          callUpdate.recordingSid = recDoc.recordingSid;
        }

        await Call.updateOne(
          { callSid: CallSid },
          { $set: callUpdate },
          { upsert: true }
        ).exec();
      }
    } catch (callErr) {
      console.warn(
        "⚠️ AI Dialer call-status-webhook: failed to upsert Call document (non-blocking):",
        (callErr as any)?.message || callErr
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // ✅ A) Server-side terminal fallback:
    // On terminal call end, guarantee:
    //  - outcome exists (if still unknown)
    //  - lead history + notes are appended (if not already)
    // This is ONLY a fallback when the agent never calls /api/ai-calls/outcome.
    //
    // ✅ IMPORTANT RELIABILITY TIGHTEN:
    // If a real outcome already exists (set by /api/ai-calls/outcome.ts), do NOT add
    // fallback history/notes (prevents duplicates and avoids any perception of overwrite).
    // ─────────────────────────────────────────────────────────────────────────────
    try {
      if (CallSid && isTerminal && recDoc) {
        const now = new Date();

        // Always re-fetch the latest recording state so we don't operate on a stale lean snapshot.
        const latestRec: any = await AICallRecording.findOne({ callSid: CallSid })
          .select(
            "_id callSid userEmail leadId outcome outcomeSource aiCallSessionId voicemailHandledAt"
          )
          .lean();

        // If we can resolve userEmail from latestRec, do it (without overwriting anything)
        if (!userEmail && latestRec?.userEmail) {
          userEmail = String(latestRec.userEmail).toLowerCase();
        }

        // Determine whether a REAL outcome already exists (agent path).
        // Any non-unknown outcome that is NOT from our fallback sources is considered "real".
        const latestOutcome = String(latestRec?.outcome || "unknown");
        const latestOutcomeSource = String(latestRec?.outcomeSource || "");

        const hasRealOutcomeAlready =
          latestOutcome &&
          latestOutcome !== "unknown" &&
          latestOutcome !== "voicemail" &&
          latestOutcomeSource !== "call_status_fallback" &&
          latestOutcomeSource !== "amd_voicemail";

        // Also treat "non-unknown with no source" as real to avoid duplicate fallback writes.
        const hasNonUnknownNoSource =
          latestOutcome &&
          latestOutcome !== "unknown" &&
          (!latestOutcomeSource || latestOutcomeSource.trim().length === 0);

        // If outcome was already produced by the agent, do nothing here (no duplicate notes/history).
        if (hasRealOutcomeAlready || hasNonUnknownNoSource) {
          // Still allow the rest of the webhook to chain session, etc.
        } else {
          // Only proceed if we have enough linkage to safely update lead artifacts
          if (latestRec && latestRec.leadId && userEmail) {
            const leadId = latestRec.leadId as Types.ObjectId;

            const mapped = mapTerminalOutcome(CallStatus, AnsweredBy);

            // If outcome is still unknown, set a conservative fallback terminal outcome.
            // Do NOT override a real outcome already set by the agent.
            if ((latestOutcome === "unknown" || !latestOutcome) && mapped) {
              await AICallRecording.updateOne(
                {
                  callSid: CallSid,
                  $or: [
                    { outcome: { $exists: false } },
                    { outcome: null },
                    { outcome: "unknown" },
                  ],
                },
                {
                  $set: {
                    outcome: mapped,
                    outcomeSource: "call_status_fallback",
                    updatedAt: now,
                  },
                }
              ).exec();
            }

            // Append lead history/notes only once per callSid (idempotent)
            const outcomeToLog = mapped || latestOutcome || "unknown";
            const historyMessageBase = `🤖 AI Dialer outcome (fallback): ${String(
              outcomeToLog
            ).replace("_", " ")}`;
            const statusBits = `Twilio status=${CallStatus}${
              AnsweredBy ? `, AnsweredBy=${AnsweredBy}` : ""
            }${
              typeof durationSec === "number" ? `, durationSec=${durationSec}` : ""
            }`;

            const historyEntry = {
              type: "ai_outcome_fallback",
              message: `${historyMessageBase} (${statusBits})`,
              timestamp: now,
              userEmail,
              meta: {
                source: "call-status-webhook",
                callSid: CallSid,
                outcome: outcomeToLog,
                recordingId: latestRec._id,
              },
            };

            const lead = await Lead.findOne({
              _id: leadId,
              $or: [
                { userEmail: userEmail },
                { ownerEmail: userEmail },
                { user: userEmail },
              ],
            }).exec();

            if (lead) {
              const existingHistory: any[] = Array.isArray((lead as any).history)
                ? (lead as any).history
                : [];
              const alreadyHasEntry = existingHistory.some((h: any) => {
                const meta = h?.meta || {};
                return (
                  meta?.callSid === CallSid &&
                  meta?.source === "call-status-webhook"
                );
              });

              if (!alreadyHasEntry) {
                existingHistory.push(historyEntry);
                (lead as any).history = existingHistory;
              }

              // Notes append behavior (also idempotent)
              const appendLine = `[AI Dialer fallback] CallSid=${CallSid} • outcome=${outcomeToLog} • ${statusBits}`;
              const existingNotes =
                ((lead as any).notes as string | undefined) ||
                ((lead as any).Notes as string | undefined) ||
                "";

              const alreadyInNotes =
                typeof existingNotes === "string" &&
                existingNotes.includes(`CallSid=${CallSid}`);

              if (!alreadyInNotes) {
                const combined =
                  existingNotes && existingNotes.trim().length > 0
                    ? `${existingNotes}\n${appendLine}`
                    : appendLine;
                (lead as any).notes = combined;
                (lead as any).Notes = combined;
              }

              (lead as any).updatedAt = now;
              await lead.save();
            }
          }
        }
      }
    } catch (fallbackErr: any) {
      console.warn(
        "⚠️ AI Dialer terminal fallback (outcome/lead history) failed (non-blocking):",
        fallbackErr?.message || fallbackErr
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // --- SESSION COMPLETION + CHAIN NEXT LEAD ---
    // Now includes CallSid-level dedupe so answered/completed callbacks can't double-kick.
    // ─────────────────────────────────────────────────────────────────────────────
    try {
      if (CallSid && recDoc && recDoc.aiCallSessionId) {
        const aiCallSessionId = recDoc.aiCallSessionId as Types.ObjectId;

        const session = await AICallSession.findById(aiCallSessionId).lean();
        if (session) {
          const s: any = session;

          const leadCount = Array.isArray(s.leadIds) ? s.leadIds.length : 0;
          const total: number =
            typeof s.total === "number" ? s.total : leadCount;

          const lastIndex: number =
            typeof s.lastIndex === "number" ? s.lastIndex : -1;

          const hasMoreLeads = leadCount > 0 && lastIndex < leadCount - 1;

          // mark session completed if we truly reached the end
          if (!hasMoreLeads && s.status !== "completed") {
            await AICallSession.updateOne(
              { _id: aiCallSessionId, status: { $ne: "completed" } },
              {
                $set: {
                  status: "completed",
                  completedAt: new Date(),
                  updatedAt: new Date(),
                },
              }
            ).exec();

            console.log(
              "[AI Dialer] Marked AI session completed from call-status-webhook",
              {
                sessionId: String(aiCallSessionId),
                userEmail,
                total,
                leadCount,
                lastIndex,
                callSid: CallSid,
                callStatus: CallStatus,
              }
            );

            return res.status(200).end();
          }

          // ✅ Chain the next call ONLY when:
          // - call ended (terminal status)
          // - session is still active (queued/running)
          // - session has more leads
          if (
            isTerminal &&
            hasMoreLeads &&
            (s.status === "queued" || s.status === "running")
          ) {
            if (AI_DIALER_DISABLED) {
              console.log(
                "[AI Dialer] Not kicking worker: AI_DIALER_DISABLED=true",
                {
                  sessionId: String(aiCallSessionId),
                  callSid: CallSid,
                  callStatus: CallStatus,
                  lastIndex,
                  leadCount,
                }
              );
              return res.status(200).end();
            }

            // ✅ Dedupe: Twilio may retry callbacks; prevent rapid re-kicks
            // ✅ AND prevent double kick for the same callSid across answered/completed
            const now = new Date();
            const recentCutoff = new Date(now.getTime() - 15000); // 15s

            const lockResult = await AICallSession.updateOne(
              {
                _id: aiCallSessionId,
                status: { $in: ["queued", "running"] },
                $and: [
                  {
                    $or: [
                      { chainKickedAt: null },
                      { chainKickedAt: { $lt: recentCutoff } },
                    ],
                  },
                  {
                    $or: [
                      { chainKickCallSid: { $exists: false } },
                      { chainKickCallSid: null },
                      { chainKickCallSid: { $ne: CallSid } },
                    ],
                  },
                ],
              },
              {
                $set: {
                  chainKickedAt: now,
                  chainKickCallSid: CallSid,
                  updatedAt: now,
                },
              }
            ).exec();

            const modified = (lockResult as any)?.modifiedCount ?? 0;

            if (modified > 0) {
              console.log(
                "[AI Dialer] Chaining next lead: kicking worker after terminal call",
                {
                  sessionId: String(aiCallSessionId),
                  callSid: CallSid,
                  callStatus: CallStatus,
                  lastIndex,
                  leadCount,
                }
              );

              await kickAiWorkerOnce(req, {
                reason: "call_terminal_chain_next",
                sessionId: String(aiCallSessionId),
                callSid: CallSid,
                callStatus: CallStatus,
                lastIndex,
                leadCount,
              });
            } else {
              console.log(
                "[AI Dialer] Suppressed duplicate chain kick (recently kicked or same CallSid)",
                {
                  sessionId: String(aiCallSessionId),
                  callSid: CallSid,
                  callStatus: CallStatus,
                  lastIndex,
                  leadCount,
                }
              );
            }
          }
        }
      }
    } catch (sessionErr) {
      console.warn(
        "⚠️ AI Dialer session completion/chain check failed (non-blocking):",
        (sessionErr as any)?.message || sessionErr
      );
    }

    return res.status(200).end();
  } catch (err) {
    console.error("❌ AI call-status-webhook error:", err);
    return res.status(200).end();
  }
}

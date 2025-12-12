// pages/api/ai-calls/call-status-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import User from "@/models/User";
import Call from "@/models/Call";
import { trackAiDialerUsage } from "@/lib/billing/trackAiDialerUsage";
import { Types } from "mongoose";

export const config = { api: { bodyParser: false } };

// Your cost per **dial minute** (Twilio + OpenAI), for margin tracking only.
const VENDOR_RATE_PER_MINUTE = Number(
  process.env.AI_DIALER_VENDOR_RATE_PER_MIN_USD || "0.03"
);

// ✅ global hard kill switch (env)
const AI_DIALER_DISABLED = String(process.env.AI_DIALER_DISABLED || "")
  .trim()
  .toLowerCase() === "true";

// ✅ used to securely kick /api/ai-calls/worker
const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

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
    console.warn("[AI Dialer] Not kicking worker: CRON_SECRET/AI_DIALER_CRON_KEY missing", meta);
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

    // Optional hints from statusCallback URL
    const qs = req.query as { userEmail?: string };
    let userEmail = (qs.userEmail || "").toString().toLowerCase() || "";

    // --- Update AICallRecording with status / duration for analytics ---

    if (CallSid) {
      const update: any = {
        lastTwilioStatus: CallStatus,
        updatedAt: new Date(),
      };

      if (typeof durationSec === "number" && durationSec >= 0) {
        update.durationSec = durationSec;
      }

      // Map Twilio status to a simple outcome label for reporting
      let outcome: string | undefined;
      switch (CallStatus) {
        case "completed":
          outcome = "completed";
          break;
        case "busy":
        case "no-answer":
          outcome = "no_answer";
          break;
        case "failed":
        case "canceled":
          outcome = "failed";
          break;
        default:
          break;
      }
      if (outcome) {
        update.outcome = outcome;
      }

      await AICallRecording.updateOne(
        { callSid: CallSid },
        { $set: update },
        { upsert: false }
      ).exec();
    }

    // We want to progress the session on terminal statuses too (not just "completed")
    const TERMINAL_STATUSES = new Set([
      "completed",
      "busy",
      "no-answer",
      "failed",
      "canceled",
    ]);

    const isTerminal = TERMINAL_STATUSES.has(CallStatus);

    // If we don't have userEmail in query, try to get it from AICallRecording
    let rec = null as any;
    if (!userEmail && CallSid) {
      rec = await AICallRecording.findOne({ callSid: CallSid }).lean();
      if (rec?.userEmail) {
        userEmail = (rec.userEmail as string).toLowerCase();
      }
    } else if (CallSid) {
      rec = await AICallRecording.findOne({ callSid: CallSid }).lean();
    }

    // --- Billing: only bill on completed calls with a positive duration ---
    if (CallStatus === "completed" && durationSec && durationSec > 0) {
      if (!userEmail) {
        console.warn(
          "[AI Dialer billing] No userEmail resolved for CallSid",
          CallSid
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
        } else {
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
          }
        }
      }
    }

    // --- SYNC INTO Call MODEL FOR LEAD ACTIVITY PANEL (AI DIALER ONLY) ---
    try {
      if (CallSid && rec && rec.leadId) {
        const now = new Date();
        const startedAt =
          typeof durationSec === "number" && durationSec > 0
            ? new Date(now.getTime() - durationSec * 1000)
            : undefined;

        const callUpdate: any = {
          userEmail,
          leadId: rec.leadId,
          direction: "outbound",
          aiEnabledAtCallTime: true,
          completedAt: now,
          duration: durationSec,
          durationSec,
        };

        if (startedAt) {
          callUpdate.startedAt = startedAt;
        }

        if (rec.recordingUrl) {
          callUpdate.recordingUrl = rec.recordingUrl;
        }
        if (rec.recordingSid) {
          callUpdate.recordingSid = rec.recordingSid;
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

    // --- SESSION COMPLETION + CHAIN NEXT LEAD ---
    try {
      if (CallSid && rec && rec.aiCallSessionId) {
        const aiCallSessionId = rec.aiCallSessionId as Types.ObjectId;

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
              console.log("[AI Dialer] Not kicking worker: AI_DIALER_DISABLED=true", {
                sessionId: String(aiCallSessionId),
                callSid: CallSid,
                callStatus: CallStatus,
                lastIndex,
                leadCount,
              });
              return res.status(200).end();
            }

            // ✅ Dedupe: Twilio may retry callbacks; prevent rapid re-kicks
            const now = new Date();
            const recentCutoff = new Date(now.getTime() - 15000); // 15s

            const lockResult = await AICallSession.updateOne(
              {
                _id: aiCallSessionId,
                status: { $in: ["queued", "running"] },
                $or: [
                  { chainKickedAt: null },
                  { chainKickedAt: { $lt: recentCutoff } },
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
              console.log("[AI Dialer] Chaining next lead: kicking worker after terminal call", {
                sessionId: String(aiCallSessionId),
                callSid: CallSid,
                callStatus: CallStatus,
                lastIndex,
                leadCount,
              });

              await kickAiWorkerOnce(req, {
                reason: "call_terminal_chain_next",
                sessionId: String(aiCallSessionId),
                callSid: CallSid,
                callStatus: CallStatus,
                lastIndex,
                leadCount,
              });
            } else {
              console.log("[AI Dialer] Suppressed duplicate chain kick (recently kicked)", {
                sessionId: String(aiCallSessionId),
                callSid: CallSid,
                callStatus: CallStatus,
                lastIndex,
                leadCount,
              });
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

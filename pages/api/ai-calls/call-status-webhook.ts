// pages/api/ai-calls/call-status-webhook.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import User from "@/models/User";
import { trackAiDialerUsage } from "@/lib/billing/trackAiDialerUsage";
import { Types } from "mongoose";

export const config = { api: { bodyParser: false } };

// Your cost per **dial minute** (Twilio + OpenAI), for margin tracking only.
const VENDOR_RATE_PER_MINUTE = Number(
  process.env.AI_DIALER_VENDOR_RATE_PER_MIN_USD || "0.03"
);

function parseIntSafe(n?: string | null): number | undefined {
  if (!n) return undefined;
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : undefined;
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
    const qs = req.query as {
      userEmail?: string;
    };
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

    // --- Billing: only bill on completed calls with a positive duration ---

    if (CallStatus !== "completed" || !durationSec || durationSec <= 0) {
      // No billing for no-answer / busy / failed / zero-duration
      return res.status(200).end();
    }

    // If we don't have userEmail in query, try to get it from AICallRecording
    if (!userEmail && CallSid) {
      const rec = await AICallRecording.findOne({ callSid: CallSid }).lean();
      if (rec?.userEmail) {
        userEmail = (rec.userEmail as string).toLowerCase();
      }
    }

    if (!userEmail) {
      console.warn(
        "[AI Dialer billing] No userEmail resolved for CallSid",
        CallSid
      );
      return res.status(200).end();
    }

    const user = await User.findOne({ email: userEmail });
    if (!user) {
      console.warn(
        "[AI Dialer billing] User not found for email",
        userEmail,
        "CallSid",
        CallSid
      );
      return res.status(200).end();
    }

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

    // --- SESSION COMPLETION: mark AICallSession completed when all calls done ---

    try {
      if (CallSid) {
        const rec = await AICallRecording.findOne({ callSid: CallSid }).lean();

        if (rec && rec.aiCallSessionId) {
          const aiCallSessionId = rec.aiCallSessionId as Types.ObjectId;

          const session = await AICallSession.findById(aiCallSessionId).lean();
          if (session) {
            const s: any = session;
            const total: number =
              typeof s.total === "number"
                ? s.total
                : Array.isArray(s.leadIds)
                ? s.leadIds.length
                : 0;

            if (total > 0) {
              // Count how many recordings we have for this session
              const completedCount = await AICallRecording.countDocuments({
                aiCallSessionId,
              });

              if (
                completedCount >= total &&
                s.status !== "completed"
              ) {
                await AICallSession.updateOne(
                  {
                    _id: aiCallSessionId,
                    status: { $ne: "completed" },
                  },
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
                    completedCount,
                  }
                );
              }
            }
          }
        }
      }
    } catch (sessionErr) {
      console.warn(
        "⚠️ AI Dialer session completion check failed (non-blocking):",
        (sessionErr as any)?.message || sessionErr
      );
    }

    return res.status(200).end();
  } catch (err) {
    console.error("❌ AI call-status-webhook error:", err);
    return res.status(200).end();
  }
}

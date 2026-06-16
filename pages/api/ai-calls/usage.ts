// pages/api/ai-calls/usage.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import AICallRecording from "@/models/AICallRecording";
import { trackAiDialerUsage } from "@/lib/billing/trackAiDialerUsage";

const AI_DIALER_AGENT_KEY = (process.env.AI_DIALER_AGENT_KEY || "").trim();

type UsageBody = {
  userEmail?: string;
  minutes?: number;
  vendorCostUsd?: number;
  callSid?: string;
  sessionId?: string;
};

type UsageResponse =
  | { ok: true }
  | { ok: false; error: string };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UsageResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({ ok: false, error: "Method not allowed" });
  }

  if (!AI_DIALER_AGENT_KEY) {
    return res
      .status(500)
      .json({ ok: false, error: "AI_DIALER_AGENT_KEY not configured" });
  }

  const hdrKey = (req.headers["x-agent-key"] || "") as string;
  if (!hdrKey || hdrKey !== AI_DIALER_AGENT_KEY) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  try {
    const { userEmail, minutes, vendorCostUsd, callSid, sessionId } =
      (req.body || {}) as UsageBody;

    if (!userEmail) {
      return res
        .status(400)
        .json({ ok: false, error: "userEmail is required" });
    }

    const mins = Number(minutes || 0);
    if (!mins || mins <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "minutes must be > 0" });
    }

    const vendorCost = Number(vendorCostUsd || 0);

    await mongooseConnect();

    const email = String(userEmail).toLowerCase();
    const user = await User.findOne({ email });

    if (!user) {
      console.warn("[AI Dialer usage] user not found:", { email, callSid, sessionId });
      return res
        .status(404)
        .json({ ok: false, error: "User not found" });
    }

    // ── Idempotency guard: claim billedAt before billing ─────────────────────
    // Prevents double-billing when both this path (ai-voice-server) and
    // call-status-webhook.ts (Twilio) fire trackAiDialerUsage for the same call.
    // Matches the identical atomic pattern in call-status-webhook.ts.
    let acquiredBillingLock = false;
    if (callSid) {
      const lockResult = await AICallRecording.updateOne(
        { callSid, $or: [{ billedAt: { $exists: false } }, { billedAt: null }] },
        { $set: { billedAt: new Date() } },
      );
      if ((lockResult.modifiedCount ?? 0) > 0) {
        acquiredBillingLock = true;
      } else {
        // modifiedCount === 0: either already billed, or no record exists yet
        const rec = await AICallRecording.findOne({ callSid }, { billedAt: 1 });
        if (rec?.billedAt) {
          console.log("[AI Dialer usage] skipped — already billed via call-status-webhook", {
            email,
            callSid,
          });
          res.setHeader("Cache-Control", "no-store");
          return res.status(200).json({ ok: true });
        }
        // No record found — proceed without lock
        // (edge case: usage fires before AICallRecording is created)
        if (!rec) {
          console.warn("[AI Dialer usage] no AICallRecording for callSid — billing without idempotency lock", {
            callSid,
          });
        }
      }
    }

    try {
      await trackAiDialerUsage({
        user,
        minutes: mins,
        vendorCostUsd: vendorCost,
      });
    } catch (billErr: any) {
      // Roll back the billing lock so call-status-webhook.ts can retry
      if (acquiredBillingLock && callSid) {
        try {
          await AICallRecording.updateOne({ callSid }, { $set: { billedAt: null } });
        } catch {
          // ignore rollback failure
        }
      }
      throw billErr;
    }

    console.log("[AI Dialer usage] tracked", {
      email,
      minutes: mins,
      vendorCostUsd: vendorCost,
      callSid,
      sessionId,
    });

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error("[AI Dialer usage] error:", err?.message || err);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to track AI Dialer usage" });
  }
}

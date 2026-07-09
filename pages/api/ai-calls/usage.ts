// pages/api/ai-calls/usage.ts
// Endpoint called by ai-voice-server after each call.
// Bills AI dialer connected talk time once per callSid.
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import AICallRecording from "@/models/AICallRecording";
import AICallSession from "@/models/AICallSession";
import AICallUsageLedger from "@/models/AICallUsageLedger";
import { trackAiDialerCentsUsage } from "@/lib/billing/trackAiDialerSessionUsage";
import {
  AI_TALK_RATE_PER_MIN,
  amountCentsForBillableSeconds,
  billableConnectedSeconds,
} from "@/lib/billing/dialerRates";

const AI_DIALER_AGENT_KEY = (process.env.AI_DIALER_AGENT_KEY || "").trim();

type UsageBody = {
  userEmail?: string;
  minutes?: number;
  vendorCostUsd?: number;
  callSid?: string;
  sessionId?: string;
};

type UsageResponse =
  | {
      ok: true;
      skipped?: boolean;
      alreadyBilled?: boolean;
      charged?: boolean;
      reason?: string;
      amountCents?: number;
      billableSeconds?: number;
    }
  | { ok: false; error: string };

function cleanEmail(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function cleanCallSid(value?: string) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").trim();
}

function postedMinutesToSeconds(minutes?: number) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 60);
}

function objectIdOrNull(value: unknown) {
  const raw = String(value || "").trim();
  return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UsageResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!AI_DIALER_AGENT_KEY) {
    return res.status(500).json({ ok: false, error: "AI_DIALER_AGENT_KEY not configured" });
  }

  const hdrKey = (req.headers["x-agent-key"] || "") as string;
  if (!hdrKey || hdrKey !== AI_DIALER_AGENT_KEY) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const { userEmail, minutes, callSid, sessionId } = (req.body || {}) as UsageBody;
  const postedEmail = cleanEmail(userEmail);
  const sid = cleanCallSid(callSid);

  if (!sid) {
    return res.status(400).json({ ok: false, error: "callSid is required" });
  }

  await dbConnect();

  const existingLedger = await AICallUsageLedger.findOne({ callSid: sid })
    .select("status amountCents billableSeconds")
    .lean();
  if (existingLedger) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      alreadyBilled: true,
      reason: `ledger_${String((existingLedger as any).status || "exists")}`,
      amountCents: Number((existingLedger as any).amountCents || 0),
      billableSeconds: Number((existingLedger as any).billableSeconds || 0),
    });
  }

  const recording = await AICallRecording.findOne({ callSid: sid })
    .select("_id userEmail aiCallSessionId durationSec outcome answeredBy")
    .lean();

  const resolvedSessionId = objectIdOrNull((recording as any)?.aiCallSessionId);
  let resolvedEmail = cleanEmail((recording as any)?.userEmail);

  if (!resolvedEmail && resolvedSessionId) {
    const session = await AICallSession.findById(resolvedSessionId).select("userEmail").lean();
    resolvedEmail = cleanEmail((session as any)?.userEmail);
  }

  if (!resolvedEmail) {
    console.error("[BILLING][OWNERSHIP-MISSING]", {
      callSid: sid,
      postedEmail: postedEmail || null,
      recordingId: (recording as any)?._id ? String((recording as any)._id) : null,
      aiCallSessionId: resolvedSessionId ? String(resolvedSessionId) : null,
    });
    return res.status(200).json({ ok: true, skipped: true, reason: "owner_not_resolved" });
  }

  if (postedEmail && postedEmail !== resolvedEmail) {
    console.error("[BILLING][OWNERSHIP-MISMATCH]", {
      callSid: sid,
      postedEmail,
      resolvedEmail,
    });
    return res.status(409).json({ ok: false, error: "Call ownership mismatch" });
  }

  const email = resolvedEmail;

  const recordingDuration =
    typeof (recording as any)?.durationSec === "number"
      ? Number((recording as any).durationSec)
      : undefined;

  const durationSec =
    typeof recordingDuration === "number" ? Math.max(0, recordingDuration) : postedMinutesToSeconds(minutes);

  const durationSource =
    typeof recordingDuration === "number" ? "twilio_duration" : "usage_post_minutes";

  const user = await User.findOne({ email }).select(
    "_id email stripeCustomerId hasEverPaid billingBlocked aiDialerUsage",
  );
  if (!user) {
    console.error("[BILLING][OWNERSHIP-MISSING]", { callSid: sid, resolvedEmail: email, reason: "user_not_found" });
    return res.status(200).json({ ok: true, skipped: true, reason: "owner_user_not_found" });
  }

  const stripeCustomerId = String((user as any).stripeCustomerId || "");

  if (durationSec <= 0) {
    await AICallUsageLedger.findOneAndUpdate(
      { callSid: sid },
      {
        $setOnInsert: {
          callSid: sid,
          userEmail: email,
          userId: (user as any)._id,
          stripeCustomerId,
          aiCallSessionId: resolvedSessionId,
          durationSec: 0,
          billableSeconds: 0,
          billableMinutes: 0,
          ratePerMinute: AI_TALK_RATE_PER_MIN,
          amountCents: 0,
          status: "skipped",
          source: durationSource,
          idempotencyKey: `ai_call_usage:${sid}`,
          metadata: {
            userEmail: email,
            callSid: sid,
            postedEmail: postedEmail || null,
            postedSessionId: sessionId || null,
            reason: "zero_duration",
          },
          skippedReason: "zero_duration",
        },
      },
      { upsert: true, new: true },
    );
    return res.status(200).json({ ok: true, skipped: true, reason: "zero_duration" });
  }

  const billableSeconds = billableConnectedSeconds(durationSec);
  const amountCents = amountCentsForBillableSeconds(billableSeconds, AI_TALK_RATE_PER_MIN);

  if (amountCents <= 0) {
    return res.status(200).json({ ok: true, skipped: true, reason: "zero_amount" });
  }

  await AICallUsageLedger.findOneAndUpdate(
    { callSid: sid },
    {
      $setOnInsert: {
        callSid: sid,
        userEmail: email,
        userId: (user as any)._id,
        stripeCustomerId,
        aiCallSessionId: resolvedSessionId,
        durationSec,
        billableSeconds,
        billableMinutes: billableSeconds / 60,
        ratePerMinute: AI_TALK_RATE_PER_MIN,
        amountCents,
        status: "pending",
        source: durationSource,
        idempotencyKey: `ai_call_usage:${sid}`,
        metadata: {
          userEmail: email,
          callSid: sid,
          postedEmail: postedEmail || null,
          postedSessionId: sessionId || null,
          postedMinutes: typeof minutes === "number" ? minutes : null,
          recordingId: (recording as any)?._id ? String((recording as any)._id) : null,
          outcome: (recording as any)?.outcome || null,
          answeredBy: (recording as any)?.answeredBy || null,
        },
      },
    },
    { upsert: true, new: false },
  );

  const claimed = await AICallUsageLedger.findOneAndUpdate(
    { callSid: sid, status: { $in: ["pending", "failed"] } },
    { $set: { status: "charging", updatedAt: new Date() } },
    { new: true },
  );

  if (!claimed) {
    const current = await AICallUsageLedger.findOne({ callSid: sid }).lean();
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: `ledger_${String((current as any)?.status || "exists")}`,
      amountCents,
      billableSeconds,
    });
  }

  try {
    const accrual = await trackAiDialerCentsUsage({
      userEmail: email,
      addCents: amountCents,
      description: `Cove CRM AI Dialer talk time (${(billableSeconds / 60).toFixed(2)} min)`,
      source: "ai_voice_call",
      eventKey: `call:${sid}`,
      metadata: {
        callSid: sid,
        sessionId: resolvedSessionId ? String(resolvedSessionId) : null,
        durationSec,
        billableSeconds,
        ratePerMinute: AI_TALK_RATE_PER_MIN,
        durationSource,
      },
    });

    await AICallUsageLedger.updateOne(
      { callSid: sid, status: "charging" },
      {
        $set: {
          status: "accrued",
          paidAt: null,
          metadata: {
            ...(claimed as any).metadata,
            accrualStatus: accrual?.ok ? "ok" : "skipped",
            thresholdInvoiceCharged: !!accrual?.charged,
            thresholdBillCents: accrual?.billCents || 0,
          },
        },
      },
    );

    await User.updateOne(
      { _id: (user as any)._id },
      {
        $inc: {
          "aiDialerUsage.billedMinutes": billableSeconds / 60,
          "aiDialerUsage.billedAmount": amountCents / 100,
        },
        $set: { "aiDialerUsage.lastChargedAt": new Date() },
      },
    );

    console.log("[AI Dialer usage] accrued talk time", {
      userEmail: email,
      callSid: sid,
      sessionId: resolvedSessionId ? String(resolvedSessionId) : sessionId,
      durationSec,
      billableSeconds,
      amountCents,
      charged: !!accrual?.charged,
    });
  } catch (err: any) {
    await AICallUsageLedger.updateOne(
      { callSid: sid, status: "charging" },
      {
        $set: {
          status: "failed",
          metadata: {
            ...(claimed as any).metadata,
            lastError: err?.message || String(err),
          },
        },
      },
    );
    return res.status(500).json({ ok: false, error: err?.message || "AI talk-time accrual failed" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, amountCents, billableSeconds });
}

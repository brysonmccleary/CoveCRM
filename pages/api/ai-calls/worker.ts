// pages/api/ai-calls/worker.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";
import AICallRecording from "@/models/AICallRecording";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { isCallAllowedForLead } from "@/utils/checkCallTime";
import { Types } from "mongoose";
import { stripe } from "@/lib/stripe";

const BASE = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

// Accept either AI_DIALER_CRON_KEY (your internal kick key)
// OR CRON_SECRET (Vercel native cron secret / your existing cron pattern)
const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

// ✅ GLOBAL HARD KILL SWITCH (ENV)
const AI_DIALER_DISABLED_RAW = String(process.env.AI_DIALER_DISABLED || "").trim();
const AI_DIALER_DISABLED =
  AI_DIALER_DISABLED_RAW === "1" ||
  AI_DIALER_DISABLED_RAW.toLowerCase() === "true" ||
  AI_DIALER_DISABLED_RAW.toLowerCase() === "yes";

// 🔹 What you charge the user: $0.15 per *dial* minute
const AI_RATE_PER_MINUTE = Number(
  process.env.AI_DIALER_BILL_RATE_PER_MINUTE || "0.15"
);

// 🔹 How much to auto-top-up by (USD)
const AI_DIALER_AUTO_TOPUP_AMOUNT_USD = Number(
  process.env.AI_DIALER_AUTO_TOPUP_AMOUNT_USD || "20"
);

// 🔹 Admins who get free AI Dialer (no charges, no balance checks)
const ADMIN_FREE_AI_EMAILS: string[] = (process.env.ADMIN_FREE_AI_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isAdminFreeEmail = (email?: string | null) =>
  !!email && ADMIN_FREE_AI_EMAILS.includes(String(email).toLowerCase());

function normalizeE164(p?: string) {
  const raw = String(p || "");
  const d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return raw.startsWith("+") ? raw : `+${d}`;
}

// Twilio will fetch TwiML from here (AI <Connect><Stream>)
const aiVoiceUrl = (sessionId: string, leadId: string) =>
  `${BASE}/api/ai-calls/voice-twiml?sessionId=${encodeURIComponent(
    sessionId
  )}&leadId=${encodeURIComponent(leadId)}`;

// Twilio posts recording events here (just stores the recording now)
const aiRecordingUrl = (sessionId: string, leadId: string) =>
  `${BASE}/api/ai-calls/recording-webhook?sessionId=${encodeURIComponent(
    sessionId
  )}&leadId=${encodeURIComponent(leadId)}`;

// 🔹 Twilio posts call completion here so we can bill by dial time
const aiCallStatusUrl = (userEmail: string) =>
  `${BASE}/api/ai-calls/call-status-webhook?userEmail=${encodeURIComponent(
    userEmail.toLowerCase()
  )}`;

/**
 * Parse "Authorization: Bearer <token>"
 */
function getBearerToken(req: NextApiRequest): string {
  const auth = String(req.headers["authorization"] || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return (m?.[1] || "").trim();
}

/**
 * Secure cron auth:
 * Accept secret via:
 *  - Authorization: Bearer <CRON_SECRET> (Vercel recommended)
 *  - x-cron-key / x-cron-secret headers
 *  - query string (?key=... or ?token=...)
 *
 * Still requires a secret match. Not weakened.
 */
function isAuthorizedCron(req: NextApiRequest): boolean {
  const hdrKey = String(
    req.headers["x-cron-key"] || req.headers["x-cron-secret"] || ""
  ).trim();

  const qsKey = String(
    (req.query.key as string | undefined) ||
      (req.query.token as string | undefined) ||
      ""
  ).trim();

  const bearer = getBearerToken(req);

  const provided = (bearer || hdrKey || qsKey || "").trim();
  if (!provided) return false;

  // Allow either secret if configured
  const allowDialerKey = !!AI_DIALER_CRON_KEY && provided === AI_DIALER_CRON_KEY;
  const allowCronSecret = !!CRON_SECRET && provided === CRON_SECRET;

  return allowDialerKey || allowCronSecret;
}

/**
 * Hard gating:
 * - NEVER dial unless there is a truly active / fresh queued session.
 * - Prevents old “queued” sessions from being processed forever by a 1/min cron.
 *
 * You can tune this window. Minimal safe default: 15 minutes.
 */
const QUEUED_FRESH_WINDOW_MINUTES = Number(
  process.env.AI_DIALER_QUEUED_FRESH_WINDOW_MINUTES || "15"
);

// ✅ Guardrails (lock + cooldown + max attempts)
const LOCK_TTL_SECONDS = Number(process.env.AI_DIALER_LOCK_TTL_SECONDS || "120");
const COOLDOWN_SECONDS = Number(process.env.AI_DIALER_COOLDOWN_SECONDS || "60");
const MAX_ATTEMPTS_PER_LEAD = Number(
  process.env.AI_DIALER_MAX_ATTEMPTS_PER_LEAD || "2"
);

async function autoTopupIfNeeded(userDoc: any): Promise<{
  balanceUSD: number;
  toppedUp: boolean;
}> {
  let currentBalance = Number(userDoc.aiDialerBalance || 0);

  if (currentBalance >= AI_RATE_PER_MINUTE) {
    return { balanceUSD: currentBalance, toppedUp: false };
  }

  if (!AI_DIALER_AUTO_TOPUP_AMOUNT_USD || AI_DIALER_AUTO_TOPUP_AMOUNT_USD <= 0) {
    console.warn(
      "[AI Dialer] Auto-topup skipped: AI_DIALER_AUTO_TOPUP_AMOUNT_USD not configured"
    );
    return { balanceUSD: currentBalance, toppedUp: false };
  }

  const customerId = userDoc.stripeCustomerId as string | undefined;
  if (!customerId) {
    console.warn("[AI Dialer] Auto-topup skipped: user has no stripeCustomerId", {
      email: userDoc.email,
    });
    return { balanceUSD: currentBalance, toppedUp: false };
  }

  const amountCents = Math.round(AI_DIALER_AUTO_TOPUP_AMOUNT_USD * 100);

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      confirm: true,
      off_session: true,
      automatic_payment_methods: { enabled: true },
      metadata: {
        purpose: "ai_dialer_topup_auto",
        email: userDoc.email || "",
      },
    });

    if (paymentIntent.status === "succeeded") {
      currentBalance += AI_DIALER_AUTO_TOPUP_AMOUNT_USD;
      userDoc.aiDialerBalance = currentBalance;
      userDoc.aiDialerLastTopUpAt = new Date();
      await userDoc.save();

      console.info("[AI Dialer] Auto-topup succeeded", {
        email: userDoc.email,
        addedUSD: AI_DIALER_AUTO_TOPUP_AMOUNT_USD,
        newBalanceUSD: currentBalance,
      });

      return { balanceUSD: currentBalance, toppedUp: true };
    }

    console.warn("[AI Dialer] Auto-topup PaymentIntent not succeeded", {
      email: userDoc.email,
      status: paymentIntent.status,
    });
  } catch (err: any) {
    console.error("[AI Dialer] Auto-topup failed", err?.message || err);
  }

  currentBalance = Number(userDoc.aiDialerBalance || currentBalance || 0);
  return { balanceUSD: currentBalance, toppedUp: false };
}

function makeRequestId() {
  return `worker_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function releaseLock(sessionId: string) {
  try {
    await AICallSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          lockOwner: null,
          lockedAt: null,
          lockExpiresAt: null,
        },
      }
    );
  } catch (e) {
    // swallow
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow both GET (cron) and POST (manual / internal triggers)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  // Require at least one secret to be configured
  if (!AI_DIALER_CRON_KEY && !CRON_SECRET) {
    return res.status(500).json({
      ok: false,
      message: "Cron auth not configured (AI_DIALER_CRON_KEY/CRON_SECRET missing)",
    });
  }

  if (!isAuthorizedCron(req)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  // ✅ GLOBAL HARD STOP (NO SIDE EFFECTS)
  if (AI_DIALER_DISABLED) {
    console.log("[AI WORKER] AI_DIALER_DISABLED=true — exiting immediately");
    return res.status(200).json({ ok: true, message: "AI_DIALER_DISABLED" });
  }

  const requestId = makeRequestId();

  try {
    await mongooseConnect();

    const now = Date.now();
    const freshCutoff = new Date(
      now - QUEUED_FRESH_WINDOW_MINUTES * 60 * 1000
    );

    // ✅ ONLY process sessions that are actually "running",
    // or "queued" but recently updated (fresh).
    const candidate: any = await AICallSession.findOne({
      total: { $gt: 0 },
      $or: [
        { status: "running" },
        { status: "queued", updatedAt: { $gte: freshCutoff } },
      ],
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean()
      .exec();

    if (!candidate) {
      console.log("[AI WORKER] no queued/running sessions (fresh window), exiting");
      return res.status(200).json({
        ok: true,
        message: "no_work",
      });
    }

    const sessionId = String(candidate._id);

    // ✅ Acquire lock atomically (prevents “already dialing” duplicates)
    const lockTtlMs = Math.max(10, LOCK_TTL_SECONDS) * 1000;
    const lockExpiresAt = new Date(Date.now() + lockTtlMs);

    const locked: any = await AICallSession.findOneAndUpdate(
      {
        _id: candidate._id,
        $or: [
          { lockExpiresAt: { $exists: false } },
          { lockExpiresAt: null },
          { lockExpiresAt: { $lt: new Date() } },
        ],
        status: { $in: ["queued", "running"] },
      },
      {
        $set: {
          lockedAt: new Date(),
          lockOwner: requestId,
          lockExpiresAt,
        },
      },
      { new: true }
    ).exec();

    if (!locked) {
      console.log("[AI WORKER] session is locked by another worker; skipping", {
        sessionId,
      });
      return res.status(200).json({ ok: true, message: "locked_skip", sessionId });
    }

    const aiSession: any = locked;

    const userEmail = String(aiSession.userEmail || "").toLowerCase();
    const fromNumber = String(aiSession.fromNumber || "").trim();
    const leadIds: any[] = Array.isArray(aiSession.leadIds) ? aiSession.leadIds : [];
    const total = typeof aiSession.total === "number" ? aiSession.total : leadIds.length;
    const lastIndex = typeof aiSession.lastIndex === "number" ? aiSession.lastIndex : -1;

    // ✅ Session-level cooldown (prevents tight loops)
    if (aiSession.cooldownUntil && new Date(aiSession.cooldownUntil).getTime() > Date.now()) {
      console.log("[AI WORKER] cooldown active; exiting", {
        sessionId,
        cooldownUntil: aiSession.cooldownUntil,
      });
      await releaseLock(sessionId);
      return res.status(200).json({ ok: true, message: "cooldown_active", sessionId });
    }

    // ✅ HARD GATING: if not ready to dial, exit 200 without side effects
    if (!userEmail || !fromNumber || !leadIds.length || total <= 0) {
      console.log("[AI WORKER] session not ready to dial, exiting", {
        sessionId,
        status: aiSession.status,
        hasUserEmail: !!userEmail,
        hasFromNumber: !!fromNumber,
        leadCount: leadIds.length,
        total,
      });

      // Only mark ERROR if it was actively running
      if (aiSession.status === "running") {
        await AICallSession.updateOne(
          { _id: sessionId },
          {
            $set: {
              status: "error",
              errorMessage:
                "Invalid AI session state (missing userEmail, fromNumber, or leadIds).",
              completedAt: new Date(),
            },
          }
        );
      }

      await releaseLock(sessionId);
      return res.status(200).json({ ok: true, message: "not_ready", sessionId });
    }

    // If the session is queued but stale, do nothing.
    if (
      aiSession.status === "queued" &&
      aiSession.updatedAt &&
      new Date(aiSession.updatedAt).getTime() < freshCutoff.getTime()
    ) {
      console.log("[AI WORKER] queued session is stale; exiting without dialing", {
        sessionId,
        updatedAt: aiSession.updatedAt,
        cutoff: freshCutoff,
      });
      await releaseLock(sessionId);
      return res.status(200).json({ ok: true, message: "stale_queued_noop", sessionId });
    }

    // ✅ DB kill switch (User.aiDialerEnabled default true)
    // NOTE: even if schema doesn't have it yet, reading works and admin endpoint can set it via update.
    const userDoc: any = await User.findOne({ email: userEmail }).lean();
    if (!userDoc) {
      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            status: "error",
            errorMessage: "AI dialer user not found for this session.",
            completedAt: new Date(),
          },
        }
      );
      console.log("[AI WORKER] user not found; marking session error and exiting", {
        sessionId,
        userEmail,
      });
      await releaseLock(sessionId);
      return res.status(200).json({ ok: false, message: "user_not_found", sessionId });
    }

    if (userDoc.aiDialerEnabled === false) {
      console.log("[AI WORKER] user.aiDialerEnabled=false; exiting without dialing", {
        sessionId,
        userEmail,
      });
      await releaseLock(sessionId);
      return res.status(200).json({ ok: true, message: "user_disabled", sessionId });
    }

    const adminFree = isAdminFreeEmail(userEmail);

    // Balance check before placing ANY new call
    if (AI_RATE_PER_MINUTE > 0 && !adminFree) {
      let balance = Number(userDoc.aiDialerBalance || 0);

      if (balance < AI_RATE_PER_MINUTE) {
        const { balanceUSD, toppedUp } = await autoTopupIfNeeded(userDoc);
        balance = balanceUSD;

        if (balance < AI_RATE_PER_MINUTE) {
          await AICallSession.updateOne(
            { _id: sessionId },
            {
              $set: {
                status: "stopped",
                errorMessage: toppedUp
                  ? "AI Dialer auto-topup completed but balance is still too low to continue. Please contact support."
                  : "AI Dialer balance is depleted and automatic top-up failed. Please update your card or add AI Dialer balance in Settings → Billing.",
                completedAt: new Date(),
              },
            }
          );

          console.log("[AI WORKER] stopped due to balance depleted", {
            sessionId,
            userEmail,
            balanceUSD: balance,
          });

          await releaseLock(sessionId);
          return res.status(200).json({
            ok: true,
            message: "stopped_balance_depleted",
            sessionId,
            balanceUSD: balance,
          });
        }
      }
    }

    // Determine next index/lead
    const nextIndex = lastIndex + 1;

    if (nextIndex >= leadIds.length) {
      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { status: "completed", completedAt: new Date() } }
      );

      console.log("[AI WORKER] Session completed; no remaining leads", {
        sessionId,
        userEmail,
        totalLeads: total,
      });

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: true,
        message: "completed_no_remaining_leads",
        sessionId,
      });
    }

    const leadId = leadIds[nextIndex];
    const leadIdStr = String(leadId);

    // ✅ attempt tracking per lead (max 2 by default)
    const attemptCounts = (aiSession.leadAttemptCounts || {}) as Record<string, number>;
    const currentAttempts = Number(attemptCounts[leadIdStr] || 0);

    if (currentAttempts >= Math.max(1, MAX_ATTEMPTS_PER_LEAD)) {
      console.log("[AI WORKER] max attempts reached for lead; skipping", {
        sessionId,
        leadId: leadIdStr,
        attempts: currentAttempts,
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            lastIndex: nextIndex,
            status: "running",
          },
        }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: true,
        message: "max_attempts_skipped",
        sessionId,
        leadId: leadIdStr,
        nextIndex,
      });
    }

    if (!Types.ObjectId.isValid(leadIdStr)) {
      console.log("[AI WORKER] invalid leadId; skipping", { sessionId, leadId: leadIdStr });

      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            lastIndex: nextIndex,
            errorMessage: "Encountered invalid leadId; skipping.",
            status: "running",
          },
        }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: false,
        message: "invalid_lead_skipped",
        sessionId,
        nextIndex,
      });
    }

    const leadDoc: any = await Lead.findOne({
      _id: leadId,
      $or: [{ userEmail: userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
    }).lean();

    // ✅ HARD STOP: if lead no longer exists, skip and advance (no Twilio calls)
    if (!leadDoc) {
      console.log("[AI WORKER] lead not found; skipping", {
        sessionId,
        leadId: leadIdStr,
        nextIndex,
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { lastIndex: nextIndex, status: "running" } }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: false,
        message: "lead_not_found_skipped",
        sessionId,
        nextIndex,
      });
    }

    // ✅ HARD STOP: if lead moved folders since session creation, treat as removed and skip
    if (aiSession.folderId && leadDoc.folderId && String(leadDoc.folderId) !== String(aiSession.folderId)) {
      console.log("[AI WORKER] lead moved folders; skipping", {
        sessionId,
        leadId: leadIdStr,
        sessionFolderId: String(aiSession.folderId),
        leadFolderId: String(leadDoc.folderId),
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { lastIndex: nextIndex, status: "running" } }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: true,
        message: "lead_moved_folder_skipped",
        sessionId,
        nextIndex,
      });
    }

    // Quiet hours gating
    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      console.log("[AI WORKER] quiet hours — skipping lead", {
        sessionId,
        leadId: leadIdStr,
        zone: zone || "unknown",
      });

      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AIQUIET_${sessionId}_${leadIdStr}`,
        outcome: "callback",
        notes: `Skipped due to quiet hours (zone: ${zone || "unknown"})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { lastIndex: nextIndex, status: "running" } }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: true,
        message: "quiet_hours_skipped",
        sessionId,
        nextIndex,
      });
    }

    // Resolve phone number
    const candidates = [
      leadDoc.phone,
      leadDoc.Phone,
      leadDoc.mobile,
      leadDoc.Mobile,
      leadDoc.primaryPhone,
      leadDoc["Primary Phone"],
    ].filter(Boolean);

    const toRaw = candidates[0];
    const to = normalizeE164(toRaw);

    if (!to) {
      console.log("[AI WORKER] lead has no valid phone; skipping", {
        sessionId,
        leadId: leadIdStr,
      });

      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AINO_PHONE_${sessionId}_${leadIdStr}`,
        outcome: "no_answer",
        notes: "Lead has no valid phone number",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { lastIndex: nextIndex, status: "running" } }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: false,
        message: "no_valid_phone_skipped",
        sessionId,
        nextIndex,
      });
    }

    const from = normalizeE164(fromNumber);
    if (!from) {
      console.log("[AI WORKER] invalid fromNumber; marking error", {
        sessionId,
        fromNumber,
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            status: "error",
            errorMessage: "AI session fromNumber is not a valid E.164 phone.",
            completedAt: new Date(),
          },
        }
      );

      await releaseLock(sessionId);
      return res.status(200).json({
        ok: false,
        message: "invalid_fromNumber_marked_error",
        sessionId,
      });
    }

    // Place the AI outbound call via user's Twilio client
    try {
      console.log("[AI WORKER] attempting call", {
        sessionId,
        folderId: String(aiSession.folderId || ""),
        leadId: leadIdStr,
        nextIndex,
        reason: "next_lead",
      });

      const { client } = await getClientForUser(userEmail);
      console.log("[ai-calls/worker] Using Twilio client for", { userEmail });

      const call = await client.calls.create({
        to,
        from,
        url: aiVoiceUrl(sessionId, leadIdStr),

        timeout: 35,

        record: true,
        recordingChannels: "dual",
        recordingStatusCallback: aiRecordingUrl(sessionId, leadIdStr),
        recordingStatusCallbackEvent: ["completed"],
        recordingStatusCallbackMethod: "POST",

        // ✅ Enable AMD metadata (does NOT change audio streaming)
        machineDetection: "Enable",
        asyncAmd: true,

        // ✅ IMPORTANT: ensure async AMD results (AnsweredBy=human/machine_*) hit our webhook
        // This enables your voicemail fast-skip to actually fire ASAP.
        asyncAmdStatusCallback: aiCallStatusUrl(userEmail),
        asyncAmdStatusCallbackMethod: "POST",

        // ✅ Send status callbacks earlier so voicemail can be skipped immediately
        statusCallback: aiCallStatusUrl(userEmail),

        // ✅ Include terminal statuses so your webhook can chain next lead on busy/no-answer/failed/canceled too
        statusCallbackEvent: [
          "initiated",
          "ringing",
          "answered",
          "completed",
          "busy",
          "no-answer",
          "failed",
          "canceled",
        ],
        statusCallbackMethod: "POST",
      } as any);

      await AICallRecording.findOneAndUpdate(
        { callSid: call.sid },
        {
          $setOnInsert: {
            userEmail,
            leadId,
            aiCallSessionId: aiSession._id,
            callSid: call.sid,
            outcome: "unknown",
            createdAt: new Date(),
          },
          $set: {
            updatedAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      // ✅ Success: advance lastIndex and clear cooldown
      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            lastIndex: nextIndex,
            status: "running",
            errorMessage: null,
            cooldownUntil: null,
            startedAt: aiSession.startedAt ? aiSession.startedAt : new Date(),
          },
        }
      );

      await releaseLock(sessionId);

      return res.status(200).json({
        ok: true,
        message: "placed_call",
        sessionId,
        callSid: call.sid,
        leadId,
        to,
        from,
        nextIndex,
      });
    } catch (twilioErr: any) {
      console.error("AI dial worker Twilio error:", twilioErr?.message || twilioErr);
      if (twilioErr?.code) console.error("[Twilio] code:", twilioErr.code);
      if (twilioErr?.status) console.error("[Twilio] status:", twilioErr.status);
      if (twilioErr?.moreInfo) console.error("[Twilio] moreInfo:", twilioErr.moreInfo);

      const nextAttempts = currentAttempts + 1;
      const cooldownUntil = new Date(Date.now() + Math.max(5, COOLDOWN_SECONDS) * 1000);

      const updatedAttemptCounts = {
        ...(attemptCounts || {}),
        [leadIdStr]: nextAttempts,
      };

      // ✅ If we hit max attempts, move past this lead next time
      const shouldSkipLeadNow = nextAttempts >= Math.max(1, MAX_ATTEMPTS_PER_LEAD);

      console.log("[AI WORKER] call failed; applying guardrails", {
        sessionId,
        leadId: leadIdStr,
        nextIndex,
        attempts: nextAttempts,
        maxAttempts: MAX_ATTEMPTS_PER_LEAD,
        cooldownUntil,
        skipLeadNow: shouldSkipLeadNow,
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            status: "running",
            errorMessage: `Twilio error: ${twilioErr?.message || twilioErr}`,
            cooldownUntil,
            leadAttemptCounts: updatedAttemptCounts,
            ...(shouldSkipLeadNow ? { lastIndex: nextIndex } : {}),
          },
        }
      );

      await releaseLock(sessionId);

      // Keep 200 so cron doesn't treat it as failure and re-run aggressively
      return res.status(200).json({
        ok: false,
        message: "twilio_error_guarded",
        sessionId,
        leadId: leadIdStr,
        attempts: nextAttempts,
        cooldownUntil,
        skipped: shouldSkipLeadNow,
      });
    }
  } catch (err: any) {
    console.error("AI dial worker error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      message: "AI dial worker failed",
      error: err?.message || String(err),
    });
  }
}

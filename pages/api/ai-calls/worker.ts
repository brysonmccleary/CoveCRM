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

  try {
    await mongooseConnect();

    const now = Date.now();
    const freshCutoff = new Date(
      now - QUEUED_FRESH_WINDOW_MINUTES * 60 * 1000
    );

    // ✅ HARD GATING: only process sessions that are actually "running",
    // or "queued" but recently created/updated (fresh).
    const aiSession: any = await AICallSession.findOne({
      total: { $gt: 0 },
      $or: [
        { status: "running" },
        { status: "queued", updatedAt: { $gte: freshCutoff } },
      ],
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    if (!aiSession) {
      console.log("[AI WORKER] no queued/running sessions (fresh window), exiting");
      return res.status(200).json({
        ok: true,
        message: "no_work",
      });
    }

    const sessionId = String(aiSession._id);
    const userEmail = String(aiSession.userEmail || "").toLowerCase();
    const fromNumber = String(aiSession.fromNumber || "").trim();
    const leadIds: any[] = Array.isArray(aiSession.leadIds) ? aiSession.leadIds : [];
    const total = typeof aiSession.total === "number" ? aiSession.total : leadIds.length;
    const lastIndex = typeof aiSession.lastIndex === "number" ? aiSession.lastIndex : -1;

    // ✅ HARD GATING: if not ready to dial, exit 200 without side effects
    // (This prevents cron from “doing anything” and avoids accidental dial attempts.)
    if (!userEmail || !fromNumber || !leadIds.length || total <= 0) {
      console.log("[AI WORKER] session not ready to dial, exiting", {
        sessionId,
        status: aiSession.status,
        hasUserEmail: !!userEmail,
        hasFromNumber: !!fromNumber,
        leadCount: leadIds.length,
        total,
      });

      // Only mark ERROR if it was actively running (meaning user explicitly started it)
      if (aiSession.status === "running") {
        aiSession.status = "error";
        aiSession.errorMessage =
          "Invalid AI session state (missing userEmail, fromNumber, or leadIds).";
        aiSession.completedAt = new Date();
        await aiSession.save();
      }

      return res.status(200).json({ ok: true, message: "not_ready", sessionId });
    }

    // If the session is queued but NOT fresh anymore, do nothing.
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
      return res.status(200).json({ ok: true, message: "stale_queued_noop", sessionId });
    }

    const adminFree = isAdminFreeEmail(userEmail);

    // Balance check before placing ANY new call (no OpenAI involvement here)
    if (AI_RATE_PER_MINUTE > 0 && !adminFree) {
      const userDoc: any = await User.findOne({ email: userEmail });
      if (!userDoc) {
        // If user doc is missing, don't keep burning cron cycles dialing
        aiSession.status = "error";
        aiSession.errorMessage =
          "AI dialer user not found for this session (billing).";
        aiSession.completedAt = new Date();
        await aiSession.save();

        return res.status(200).json({
          ok: false,
          message: "user_not_found_marked_error",
          sessionId,
        });
      }

      let balance = Number(userDoc.aiDialerBalance || 0);

      if (balance < AI_RATE_PER_MINUTE) {
        const { balanceUSD, toppedUp } = await autoTopupIfNeeded(userDoc);
        balance = balanceUSD;

        if (balance < AI_RATE_PER_MINUTE) {
          aiSession.status = "stopped";
          aiSession.errorMessage = toppedUp
            ? "AI Dialer auto-topup completed but balance is still too low to continue. Please contact support."
            : "AI Dialer balance is depleted and automatic top-up failed. Please update your card or add AI Dialer balance in Settings → Billing.";
          aiSession.completedAt = new Date();
          await aiSession.save();

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
      aiSession.status = "completed";
      aiSession.completedAt = new Date();
      await aiSession.save();

      console.log("[AI Dialer] Session completed; email agent about completion", {
        userEmail,
        sessionId,
        totalLeads: total,
      });

      return res.status(200).json({
        ok: true,
        message: "completed_no_remaining_leads",
        sessionId,
      });
    }

    const leadId = leadIds[nextIndex];
    if (!Types.ObjectId.isValid(String(leadId))) {
      aiSession.lastIndex = nextIndex;
      aiSession.errorMessage = "Encountered invalid leadId; skipping.";
      aiSession.status = "running";
      await aiSession.save();
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

    if (!leadDoc) {
      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "lead_not_found_skipped",
        sessionId,
        nextIndex,
      });
    }

    // Quiet hours gating
    const { allowed, zone } = isCallAllowedForLead(leadDoc);
    if (!allowed) {
      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AIQUIET_${sessionId}_${String(leadId)}`,
        outcome: "callback",
        notes: `Skipped due to quiet hours (zone: ${zone || "unknown"})`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

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
      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AINO_PHONE_${sessionId}_${String(leadId)}`,
        outcome: "no_answer",
        notes: "Lead has no valid phone number",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "no_valid_phone_skipped",
        sessionId,
        nextIndex,
      });
    }

    const from = normalizeE164(fromNumber);
    if (!from) {
      aiSession.status = "error";
      aiSession.errorMessage = "AI session fromNumber is not a valid E.164 phone.";
      aiSession.completedAt = new Date();
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "invalid_fromNumber_marked_error",
        sessionId,
      });
    }

    // Place the AI outbound call via user's Twilio client
    try {
      const { client } = await getClientForUser(userEmail);
      console.log("[ai-calls/worker] Using Twilio client for", { userEmail });

      const call = await client.calls.create({
        to,
        from,
        url: aiVoiceUrl(sessionId, String(leadId)),

        timeout: 35,

        record: true,
        recordingChannels: "dual",
        recordingStatusCallback: aiRecordingUrl(sessionId, String(leadId)),
        recordingStatusCallbackEvent: ["completed"],
        recordingStatusCallbackMethod: "POST",

        statusCallback: aiCallStatusUrl(userEmail),
        statusCallbackEvent: ["completed"],
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

      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      aiSession.errorMessage = null;
      if (!aiSession.startedAt) aiSession.startedAt = new Date();
      await aiSession.save();

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

      const msg = String(twilioErr?.message || "").toLowerCase();
      if (msg.includes("authenticate") || twilioErr?.status === 401) {
        aiSession.status = "error";
        aiSession.errorMessage =
          "Twilio authentication failed for this AI session. Check Twilio credentials for this user.";
        aiSession.completedAt = new Date();
        await aiSession.save();

        return res.status(500).json({
          ok: false,
          message: "twilio_auth_failed",
          error: twilioErr?.message || String(twilioErr),
        });
      }

      aiSession.status = "running";
      aiSession.errorMessage = `Twilio error: ${twilioErr?.message || twilioErr}`;
      await aiSession.save();

      return res.status(500).json({
        ok: false,
        message: "twilio_error",
        error: twilioErr?.message || String(twilioErr),
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

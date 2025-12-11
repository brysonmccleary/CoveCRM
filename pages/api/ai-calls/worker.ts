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

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

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
 * Try to auto-charge the user for a $20 AI Dialer top-up when their balance
 * is too low to cover even 1 billed minute.
 *
 * - Uses Stripe PaymentIntent off-session with the customer's default method.
 * - On success, credits `aiDialerBalance` and updates `aiDialerLastTopUpAt`.
 * - Returns the *new* balance and whether a top-up actually happened.
 */
async function autoTopupIfNeeded(userDoc: any): Promise<{
  balanceUSD: number;
  toppedUp: boolean;
}> {
  let currentBalance = Number(userDoc.aiDialerBalance || 0);

  // Already enough balance for at least one billed minute
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
    console.warn(
      "[AI Dialer] Auto-topup skipped: user has no stripeCustomerId",
      { email: userDoc.email }
    );
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

  // If we get here, no top-up happened
  currentBalance = Number(userDoc.aiDialerBalance || currentBalance || 0);
  return { balanceUSD: currentBalance, toppedUp: false };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Allow both GET (for Vercel cron) and POST (manual / external triggers)
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!AI_DIALER_CRON_KEY) {
    return res
      .status(500)
      .json({ ok: false, message: "AI dialer cron key not configured" });
  }

  // Accept secret via header OR query string (?key= / ?token=)
  const hdrKey = (req.headers["x-cron-key"] ||
    req.headers["x-cron-secret"] ||
    "") as string;

  const qsKey =
    (req.query.key as string | undefined) ||
    (req.query.token as string | undefined) ||
    "";

  const providedKey = (hdrKey || qsKey || "").trim();

  // Debug logs for local only
  if (process.env.NODE_ENV !== "production") {
    console.log("[AI WORKER] providedKey raw:", JSON.stringify(providedKey));
    console.log("[AI WORKER] expectedKey raw:", JSON.stringify(AI_DIALER_CRON_KEY));
    console.log("[AI WORKER] provided len:", providedKey.length);
    console.log("[AI WORKER] expected len:", AI_DIALER_CRON_KEY.length);
  }

  if (!providedKey || providedKey !== AI_DIALER_CRON_KEY) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  try {
    await mongooseConnect();

    // Find one active AI dial session to advance.
    // We keep it simple: pick the most recently updated queued/running session.
    const aiSession: any = await AICallSession.findOne({
      status: { $in: ["queued", "running"] },
      total: { $gt: 0 },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .exec();

    if (!aiSession) {
      return res.status(200).json({
        ok: true,
        message: "No AI dial sessions to process",
      });
    }

    const sessionId = String(aiSession._id);
    const userEmail = String(aiSession.userEmail || "").toLowerCase();
    const fromNumber = String(aiSession.fromNumber || "").trim();
    const leadIds: any[] = Array.isArray(aiSession.leadIds)
      ? aiSession.leadIds
      : [];
    const total =
      typeof aiSession.total === "number" ? aiSession.total : leadIds.length;
    const lastIndex =
      typeof aiSession.lastIndex === "number" ? aiSession.lastIndex : -1;

    if (!userEmail || !fromNumber || !leadIds.length || total <= 0) {
      aiSession.status = "error";
      aiSession.errorMessage =
        "Invalid AI session state (missing userEmail, fromNumber, or leadIds).";
      aiSession.completedAt = new Date();
      await aiSession.save();
      return res.status(200).json({
        ok: false,
        message: "Invalid AI session state; marked as error.",
      });
    }

    const adminFree = isAdminFreeEmail(userEmail);

    // 🔹 Check AI dialer balance before placing ANY new call
    //     - For normal users: require enough balance for at least 1 billed minute.
    //     - For admin-free users: skip billing entirely (they're free).
    if (AI_RATE_PER_MINUTE > 0 && !adminFree) {
      // NOTE: we need a real Mongoose doc here (no .lean()) so we can save updates.
      const userDoc: any = await User.findOne({ email: userEmail });

      if (!userDoc) {
        aiSession.status = "error";
        aiSession.errorMessage =
          "AI dialer user not found for this session (billing).";
        aiSession.completedAt = new Date();
        await aiSession.save();

        return res.status(200).json({
          ok: false,
          message:
            "User not found for AI dialer session; session marked error.",
          sessionId,
        });
      }

      let balance = Number(userDoc.aiDialerBalance || 0);

      if (balance < AI_RATE_PER_MINUTE) {
        // Try auto-topup once
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
            message:
              "AI Dialer balance depleted; session stopped until billing is resolved.",
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

      // 🔔 HOOK: send "AI dial session ended" email to the agent here
      // We’ll wire this to your actual email helper in lib/email.ts.
      console.log("[AI Dialer] Session completed; email agent about completion", {
        userEmail,
        sessionId,
        totalLeads: total,
      });

      return res.status(200).json({
        ok: true,
        message: "AI session completed (no remaining leads).",
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
        message: "Invalid leadId encountered; skipped.",
        sessionId,
        nextIndex,
      });
    }

    const leadDoc: any = await Lead.findOne({
      _id: leadId,
      $or: [
        { userEmail: userEmail },
        { ownerEmail: userEmail },
        { user: userEmail },
      ],
    }).lean();

    if (!leadDoc) {
      // Skip this lead and move on
      aiSession.lastIndex = nextIndex;
      aiSession.status = "running";
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "Lead not found or access denied; skipped.",
        sessionId,
        nextIndex,
      });
    }

    // Respect quiet hours with same helper as manual dialer
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
        message: "Lead skipped due to quiet hours.",
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
        message: "Lead has no valid phone number; skipped.",
        sessionId,
        nextIndex,
      });
    }

    const from = normalizeE164(fromNumber);
    if (!from) {
      aiSession.status = "error";
      aiSession.errorMessage =
        "AI session fromNumber is not a valid E.164 phone.";
      aiSession.completedAt = new Date();
      await aiSession.save();

      return res.status(200).json({
        ok: false,
        message: "Invalid fromNumber for AI session; session marked error.",
        sessionId,
      });
    }

    // Place the AI outbound call via user's Twilio client
    try {
      const { client } = await getClientForUser(userEmail);
      console.log("[ai-calls/worker] Using Twilio client for", {
        userEmail,
      });

      const call = await client.calls.create({
        to,
        from,
        url: aiVoiceUrl(sessionId, String(leadId)),

        // 🔔 NEW: if it rings more than 35 seconds with no answer, give up.
        timeout: 35,

        // ✅ Recording for QA / summaries (talk-time only)
        record: true,
        recordingChannels: "dual",
        recordingStatusCallback: aiRecordingUrl(sessionId, String(leadId)),
        recordingStatusCallbackEvent: ["completed"],
        recordingStatusCallbackMethod: "POST",

        // ✅ Bill based on *dial time* when the call completes
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
        message: "Placed AI outbound call.",
        sessionId,
        callSid: call.sid,
        leadId,
        to,
        from,
        nextIndex,
      });
    } catch (twilioErr: any) {
      // Twilio auth or API error
      console.error(
        "AI dial worker Twilio error:",
        twilioErr?.message || twilioErr
      );
      if (twilioErr?.code) {
        console.error("[Twilio] code:", twilioErr.code);
      }
      if (twilioErr?.status) {
        console.error("[Twilio] status:", twilioErr.status);
      }
      if (twilioErr?.moreInfo) {
        console.error("[Twilio] moreInfo:", twilioErr.moreInfo);
      }

      // If it's an auth error ("Authenticate" / 401), mark session as error
      const msg = String(twilioErr?.message || "").toLowerCase();
      if (msg.includes("authenticate") || twilioErr?.status === 401) {
        aiSession.status = "error";
        aiSession.errorMessage =
          "Twilio authentication failed for this AI session. Check Twilio credentials for this user.";
        aiSession.completedAt = new Date();
        await aiSession.save();

        return res.status(500).json({
          ok: false,
          message: "AI dial worker failed (Twilio authentication).",
          error: twilioErr?.message || String(twilioErr),
        });
      }

      // Otherwise, keep session running but log error against this lead
      aiSession.status = "running";
      aiSession.errorMessage = `Twilio error: ${
        twilioErr?.message || twilioErr
      }`;
      await aiSession.save();

      return res.status(500).json({
        ok: false,
        message: "AI dial worker Twilio error",
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

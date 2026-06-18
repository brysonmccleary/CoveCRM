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
import { checkCallingAllowed } from "@/lib/billing/checkCallingAllowed";
import { selectLocalPresenceNumber } from "@/lib/twilio/localPresence";

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

// 🔹 Admins who get free AI Dialer (no charges, no balance checks)
const ADMIN_FREE_AI_EMAILS: string[] = (process.env.ADMIN_FREE_AI_EMAILS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isAdminFreeEmail = (email?: string | null) =>
  !!email && ADMIN_FREE_AI_EMAILS.includes(String(email).toLowerCase());

// ✅ TEMP DEBUG: bypass AMD/voicemail-fast-skip for specific emails (so calls don't instantly end while testing)
// Comma-separated list, lowercased. Example: "bryson.mccleary1@gmail.com"
const AI_DIALER_BYPASS_AMD_EMAILS: string[] = (
  process.env.AI_DIALER_BYPASS_AMD_EMAILS || ""
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const isBypassAmdEmail = (email?: string | null) => {
  const e = String(email || "").toLowerCase();
  if (!e) return false;
  // Default include Bryson's email even if env isn't set, since you asked for it explicitly
  if (e === "bryson.mccleary1@gmail.com") return true;
  return AI_DIALER_BYPASS_AMD_EMAILS.includes(e);
};

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
const aiCallStatusUrl = (userEmail: string, sessionId: string, leadId: string) =>
  `${BASE}/api/ai-calls/call-status-webhook?userEmail=${encodeURIComponent(
    userEmail.toLowerCase()
  )}&sessionId=${encodeURIComponent(sessionId)}&leadId=${encodeURIComponent(leadId)}`;

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

// If a call is marked active but Twilio never sends a terminal callback, recover it.
const ACTIVE_CALL_STALE_MS = 10 * 60 * 1000;

// ✅ Guardrails (lock + cooldown + max attempts)
const LOCK_TTL_SECONDS = Number(process.env.AI_DIALER_LOCK_TTL_SECONDS || "120");
const COOLDOWN_SECONDS = Number(process.env.AI_DIALER_COOLDOWN_SECONDS || "60");
const MAX_ATTEMPTS_PER_LEAD = Number(
  process.env.AI_DIALER_MAX_ATTEMPTS_PER_LEAD || "2"
);


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

// Fire-and-forget kick to chain the next lead after a skip path.
// Does not await  -  the current request has already completed its work.
function fireAndForgetWorkerKick(sessionId: string): void {
  const secret = (CRON_SECRET || AI_DIALER_CRON_KEY).trim();
  if (!secret) return;
  const url = `${BASE}/api/ai-calls/worker?sessionId=${encodeURIComponent(sessionId)}`;
  fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "x-cron-key": secret,
      "x-cron-secret": secret,
    },
  }).catch(() => {});
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
    console.log("[AI WORKER] AI_DIALER_DISABLED=true  -  exiting immediately");
    return res.status(200).json({ ok: true, message: "AI_DIALER_DISABLED" });
  }

  // Optional targeted sessionId  -  passed by webhook chain kicks and resume kicks.
  // When present, worker processes ONLY that session (no global sweep).
  const rawSessionId = String(
    (req.query.sessionId as string | undefined) ||
    ((req.body as any)?.sessionId as string | undefined) ||
    ""
  ).trim();
  const targetSessionId: string | null = rawSessionId || null;

  if (targetSessionId && !Types.ObjectId.isValid(targetSessionId)) {
    return res.status(400).json({ ok: false, message: "Invalid sessionId" });
  }

  const requestId = makeRequestId();

  try {
    await mongooseConnect();

    const now = Date.now();
    const activeCallStaleCutoff = new Date(now - ACTIVE_CALL_STALE_MS);

    const lockTtlMs = Math.max(10, LOCK_TTL_SECONDS) * 1000;
    const lockExpiresAt = new Date(Date.now() + lockTtlMs);

    const buildLockFilter = (id: any) => ({
      _id: id,
      $or: [
        { lockExpiresAt: { $exists: false } },
        { lockExpiresAt: null },
        { lockExpiresAt: { $lt: new Date() } },
      ],
      status: { $in: ["queued", "running"] },
      callDirection: { $ne: "inbound" },
      scriptKey: { $ne: "kayla_signup" },
    });

    const lockUpdate = {
      $set: {
        lockedAt: new Date(),
        lockOwner: requestId,
        lockExpiresAt,
        lastWorkerKickAt: new Date(),
      },
    };

    let candidate: any = null;
    let locked: any = null;
    let sessionId = "";

    if (targetSessionId) {
      // ✅ Targeted kick  -  only process this exact session
      candidate = await AICallSession.findOne({
        _id: new Types.ObjectId(targetSessionId),
        total: { $gt: 0 },
        callDirection: { $ne: "inbound" },
        scriptKey: { $ne: "kayla_signup" },
        status: { $in: ["running", "queued"] },
      }).lean().exec();

      if (!candidate) {
        console.log("[AI WORKER] targeted session not found or not active", { targetSessionId });
        return res.status(200).json({ ok: true, message: "no_work", sessionId: targetSessionId });
      }

      sessionId = String(candidate._id);
      locked = await AICallSession.findOneAndUpdate(
        buildLockFilter(candidate._id),
        lockUpdate,
        { new: true }
      ).exec();

      if (!locked) {
        console.log("[AI WORKER] targeted session is locked by another worker; skipping", { sessionId });
        return res.status(200).json({ ok: true, message: "locked_skip", sessionId });
      }
    } else {
      // ✅ Cron sweep  -  pick active sessions with remaining leads and no fresh call in flight.
      const cronCandidates: any[] = await AICallSession.find({
        total: { $gt: 0 },
        callDirection: { $ne: "inbound" },
        scriptKey: { $ne: "kayla_signup" },
        status: { $in: ["queued", "running"] },
        $expr: {
          $lt: ["$lastIndex", { $subtract: [{ $size: "$leadIds" }, 1] }],
        },
        $or: [
          { activeCallSid: { $exists: false } },
          { activeCallSid: null },
          { activeCallSid: "" },
          { activeCallSidAt: { $lt: activeCallStaleCutoff } },
        ],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(3)
        .lean()
        .exec();

      if (!cronCandidates.length) {
        console.log("[AI WORKER] no queued/running sessions with remaining leads, exiting");
        return res.status(200).json({ ok: true, message: "no_work" });
      }

      for (const c of cronCandidates) {
        const attempt: any = await AICallSession.findOneAndUpdate(
          buildLockFilter(c._id),
          lockUpdate,
          { new: true }
        ).exec();
        if (attempt) {
          candidate = c;
          locked = attempt;
          break;
        }
      }

      if (!locked) {
        console.log("[AI WORKER] all candidate sessions locked; skipping");
        return res.status(200).json({ ok: true, message: "locked_skip" });
      }

      sessionId = String(locked._id);
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
      // Best-effort delayed recovery after cooldown expires. setTimeout is unreliable in
      // serverless (Vercel kills the function after response). The cron sweep is the
      // authoritative recovery  -  this fires only if the instance stays warm.
      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { cooldownUntil: null } }
      );
      fireAndForgetWorkerKick(sessionId);
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

    // ✅ Active-call guard: a fresh active call means Twilio is still working.
    // If the active call is stale, clear it and continue to the next lead.
    if (aiSession.activeCallSid) {
      if (!aiSession.activeCallSidAt) {
        console.warn("[AI WORKER] active call sid has no timestamp; skipping to avoid duplicate dialing", {
          sessionId,
          activeCallSid: aiSession.activeCallSid,
        });
        await releaseLock(sessionId);
        return res.status(200).json({
          ok: true,
          message: "active_call_missing_timestamp",
          sessionId,
          activeCallSid: aiSession.activeCallSid,
        });
      }

      const activeAgeMs = Date.now() - new Date(aiSession.activeCallSidAt).getTime();
      const activeAgeSec = activeAgeMs / 1000;
      if (!Number.isFinite(activeAgeMs) || activeAgeMs < ACTIVE_CALL_STALE_MS) {
        console.log("[AI WORKER] active call in progress for session; skipping", {
          sessionId,
          activeCallSid: aiSession.activeCallSid,
          activeAgeSec: Math.round(activeAgeSec),
        });
        await releaseLock(sessionId);
        return res.status(200).json({
          ok: true,
          message: "active_call_in_progress",
          sessionId,
          activeCallSid: aiSession.activeCallSid,
        });
      }

      let twilioCallStatus = "";
      try {
        const { client } = await getClientForUser(userEmail);
        const twilioCall = await client.calls(String(aiSession.activeCallSid)).fetch();
        twilioCallStatus = String((twilioCall as any)?.status || "").toLowerCase();
      } catch (err: any) {
        console.warn("[AI WORKER] stale active call status check failed; skipping to avoid duplicate dialing", {
          sessionId,
          activeCallSid: aiSession.activeCallSid,
          activeAgeSec: Math.round(activeAgeSec),
          error: err?.message || err,
        });
        await releaseLock(sessionId);
        return res.status(200).json({
          ok: true,
          message: "active_call_status_check_failed",
          sessionId,
          activeCallSid: aiSession.activeCallSid,
        });
      }

      const twilioStillActive = ["queued", "initiated", "ringing", "in-progress"].includes(twilioCallStatus);
      if (twilioStillActive) {
        console.log("[AI WORKER] stale active call timestamp but Twilio call is still active; skipping", {
          sessionId,
          activeCallSid: aiSession.activeCallSid,
          activeAgeSec: Math.round(activeAgeSec),
          twilioCallStatus,
        });
        await releaseLock(sessionId);
        return res.status(200).json({
          ok: true,
          message: "active_call_still_live",
          sessionId,
          activeCallSid: aiSession.activeCallSid,
          twilioCallStatus,
        });
      }

      console.warn("[AI WORKER] stale active call is terminal in Twilio; clearing and continuing", {
        sessionId,
        activeCallSid: aiSession.activeCallSid,
        activeAgeSec: Math.round(activeAgeSec),
        twilioCallStatus,
      });
      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            activeCallSid: null,
            activeCallSidAt: null,
            errorMessage: "Recovered stale active AI call and continued dialing.",
          },
        }
      );
      aiSession.activeCallSid = null;
      aiSession.activeCallSidAt = null;
    }

    // ✅ DB kill switch (User.aiDialerEnabled default true)
    const userDoc: any = await User.findOne({ email: userEmail });
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
    const bypassAmd = isBypassAmdEmail(userEmail);

    if (!adminFree && userDoc.hasAI !== true) {
      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            status: "stopped",
            errorMessage: "AI Dialer access is not enabled for this account.",
            completedAt: new Date(),
          },
        }
      );
      console.log("[AI WORKER] stopped due to missing AI entitlement", {
        sessionId,
        userEmail,
      });
      await releaseLock(sessionId);
      return res.status(200).json({
        ok: true,
        message: "stopped_ai_not_enabled",
        sessionId,
      });
    }

    // Block calling if the account is not billing-ready or a payment issue blocks calling.
    if (!adminFree) {
      const billingCheck = await checkCallingAllowed(userEmail);
      if (!billingCheck.allowed) {
        await AICallSession.updateOne(
          { _id: sessionId },
          {
            $set: {
              status: "stopped",
              errorMessage: billingCheck.reason || "Calling blocked due to payment issue.",
              completedAt: new Date(),
            },
          }
        );
        console.log("[AI WORKER] stopped due to calling blocked (billing)", {
          sessionId,
          userEmail,
          reason: billingCheck.reason,
        });
        await releaseLock(sessionId);
        return res.status(200).json({
          ok: true,
          message: "stopped_calling_blocked",
          sessionId,
        });
      }
    }

    if (bypassAmd) {
      console.log("[AI WORKER] AMD bypass enabled for this user (debug)", {
        sessionId,
        userEmail,
      });
    }

    // Determine next index/lead
    const nextIndex = lastIndex + 1;

    if (nextIndex >= leadIds.length) {
      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            status: "completed",
            completedAt: new Date(),
            activeCallSid: null,
            activeCallSidAt: null,
          },
        }
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
          $inc: { "stats.skipped": 1 },
        }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
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
          $inc: { "stats.skipped": 1 },
        }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
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
        { $set: { lastIndex: nextIndex, status: "running" }, $inc: { "stats.skipped": 1 } }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
      return res.status(200).json({
        ok: false,
        message: "lead_not_found_skipped",
        sessionId,
        nextIndex,
      });
    }

    // ✅ DNC guard: never call a lead marked Do Not Call / Do Not Contact
    const isDNC =
      leadDoc.doNotCall === true ||
      leadDoc.status === "Do Not Call" ||
      leadDoc.status === "Do Not Contact";

    if (isDNC) {
      console.log("[AI WORKER] lead is DNC; skipping without calling", {
        sessionId,
        leadId: leadIdStr,
        nextIndex,
        status: leadDoc.status,
      });

      await AICallRecording.create({
        userEmail,
        leadId,
        aiCallSessionId: aiSession._id,
        callSid: `AIDNC_${sessionId}_${leadIdStr}`,
        outcome: "do_not_call",
        notes: `Skipped: lead status=${leadDoc.status || "doNotCall=true"} — DNC guard`,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { lastIndex: nextIndex, status: "running" }, $inc: { "stats.skipped": 1 } }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
      return res.status(200).json({
        ok: true,
        message: "dnc_skipped",
        sessionId,
        leadId: leadIdStr,
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
        { $set: { lastIndex: nextIndex, status: "running" }, $inc: { "stats.skipped": 1 } }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
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
      console.log("[AI WORKER] quiet hours  -  skipping lead", {
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
        { $set: { lastIndex: nextIndex, status: "running" }, $inc: { "stats.skipped": 1 } }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
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
        { $set: { lastIndex: nextIndex, status: "running" }, $inc: { "stats.skipped": 1 } }
      );

      await releaseLock(sessionId);
      fireAndForgetWorkerKick(sessionId);
      return res.status(200).json({
        ok: false,
        message: "no_valid_phone_skipped",
        sessionId,
        nextIndex,
      });
    }

    let resolvedFromNumber = fromNumber;

    if (fromNumber === "LOCAL_PRESENCE") {
      const fallback = normalizeE164(
        ((userDoc as any)?.numbers || [])[0]?.phoneNumber || ""
      );
      const result = selectLocalPresenceNumber(
        leadDoc || {},
        (userDoc as any)?.numbers || [],
        fallback
      );
      resolvedFromNumber = result.fromNumber;
      console.log("[LOCAL_PRESENCE] worker resolved", {
        matchSource: result.matchSource,
        matchedState: result.matchedState,
        resolvedFromNumber,
        userEmail,
        leadId: leadIdStr,
      });
    }

    const from = normalizeE164(resolvedFromNumber);
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

      const callCreate: any = {
        to,
        from,
        url: aiVoiceUrl(sessionId, leadIdStr),

        timeout: 35,

        record: true,
        recordingChannels: "dual",
        recordingStatusCallback: aiRecordingUrl(sessionId, leadIdStr),
        recordingStatusCallbackEvent: ["completed"],
        recordingStatusCallbackMethod: "POST",

        // ✅ Always keep normal status callbacks (billing + chaining next lead)
        statusCallback: aiCallStatusUrl(userEmail, sessionId, leadIdStr),
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
      };

      // ✅ Only enable AMD when NOT bypassing (bypass prevents "voicemail fast-skip" ending calls during testing)
      if (!bypassAmd) {
        callCreate.machineDetection = "Enable";
        callCreate.asyncAmd = true;
        callCreate.asyncAmdStatusCallback = aiCallStatusUrl(userEmail, sessionId, leadIdStr);
        callCreate.asyncAmdStatusCallbackMethod = "POST";
      }

      const call = await client.calls.create(callCreate);

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

      // ✅ Success: advance lastIndex, record active call state, clear cooldown
      const callPlacedAt = new Date();
      await AICallSession.updateOne(
        { _id: sessionId },
        {
          $set: {
            lastIndex: nextIndex,
            status: "running",
            errorMessage: null,
            cooldownUntil: null,
            startedAt: aiSession.startedAt ? aiSession.startedAt : callPlacedAt,
            activeCallSid: call.sid,
            activeCallSidAt: callPlacedAt,
            lastPlacedCallAt: callPlacedAt,
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
      await AICallSession.updateOne(
        { _id: sessionId },
        { $set: { cooldownUntil: null } }
      );
      fireAndForgetWorkerKick(sessionId);

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

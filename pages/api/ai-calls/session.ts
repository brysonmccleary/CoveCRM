// pages/api/ai-calls/session.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { requireBillingReady } from "@/lib/billing/requireBillingReady";
import { Types } from "mongoose";

type GetResponse =
  | { ok: false; message: string }
  | { ok: true; session: any | null; workerKickOk?: boolean }
  | { ok: false; error: string };

type PostBody = {
  folderId?: string;
  mode?: "fresh" | "resume";
  fromNumber?: string;
  scriptKey?: string;
  /**
   * Voice persona key – must match one of the keys used in:
   * - pages/ai-dial-session.tsx → VOICE_OPTIONS
   * - pages/api/ai-calls/context.ts → VOICE_PROFILES
   *
   * Current expected values:
   *  - "jacob"
   *  - "iris"
   *  - "kayla"
   *  - "elena"
   */
  voiceKey?: string;
};

// ✅ Canonical script keys used end-to-end by the voice server prompt builder
const CANONICAL_SCRIPTS = [
  "mortgage_protection",
  "final_expense",
  "iul_cash_value",
  "veteran_leads",
  "trucker_leads",
  "generic_life",
  "kayla_signup",
] as const;

type CanonicalScriptKey = (typeof CANONICAL_SCRIPTS)[number];

function normalizeScriptKey(raw: any): CanonicalScriptKey {
  const v = String(raw || "")
    .trim()
    .toLowerCase();

  if (!v) return "mortgage_protection";

  // ✅ Normalize older/alternate keys → canonical keys
  if (v === "mortgage" || v === "mortgageprotect" || v === "mp") {
    return "mortgage_protection";
  }

  // Final Expense variants
  if (
    v === "final_expense" ||
    v === "finalexpense" ||
    v === "fe" ||
    v === "fex" ||
    v === "fex_default" ||
    v === "final_expense_default"
  ) {
    return "final_expense";
  }

  // IUL variants
  if (v === "iul" || v === "iul_leads" || v === "iul_cash_value") {
    return "iul_cash_value";
  }

  // Veteran variants
  if (v === "veterans" || v === "veteran" || v === "veteran_leads") {
    return "veteran_leads";
  }

  // Trucker variants
  if (v === "trucker" || v === "truckers" || v === "trucker_leads") {
    return "trucker_leads";
  }

  // Generic/catch-all
  if (v === "generic" || v === "life" || v === "generic_life") {
    return "generic_life";
  }

  // Kayla demo calls — internal only, never accessible via normal AI Dial Session UI
  if (v === "kayla_signup" || v === "kayla" || v === "kayla_demo") {
    return "kayla_signup";
  }

  // If they already sent canonical, accept it
  if ((CANONICAL_SCRIPTS as readonly string[]).includes(v)) {
    return v as CanonicalScriptKey;
  }

  // Unknown → safest default (prevents "wrong script" drift)
  return "mortgage_protection";
}

// 🔹 Base URL for talking to the AI voice server (HTTP)
// We derive it from AI_VOICE_STREAM_URL, which is used for wss:// streaming.
// Example env:
//   AI_VOICE_STREAM_URL = wss://ai-voice.covecrm.com
// → AI_VOICE_HTTP_BASE = https://ai-voice.covecrm.com
const RAW_STREAM_URL = (process.env.AI_VOICE_STREAM_URL || "").trim();
const AI_VOICE_HTTP_BASE = RAW_STREAM_URL
  ? RAW_STREAM_URL.replace(/^wss:/, "https:")
      .replace(/^ws:/, "http:")
      .replace(/\/$/, "")
  : "";

const BASE_URL_SESSION = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

const SESSION_CRON_SECRET = (process.env.CRON_SECRET || "").trim();
const SESSION_DIALER_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();

// Directly kicks the worker for a specific session.
// Used as backup on session start (Render cold-start resilience) and on resume.
async function kickWorkerForSession(sessionId: string): Promise<void> {
  const secret = SESSION_CRON_SECRET || SESSION_DIALER_KEY;
  if (!secret) return;
  const url = `${BASE_URL_SESSION}/api/ai-calls/worker?sessionId=${encodeURIComponent(sessionId)}`;
  await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "x-cron-key": secret,
      "x-cron-secret": secret,
    },
    signal: AbortSignal.timeout(3000),
  });
}

async function notifyVoiceServerStartSession(params: {
  userEmail: string;
  sessionId: string;
  folderId: string;
  total: number;
}): Promise<boolean> {
  if (!AI_VOICE_HTTP_BASE) {
    throw new Error(
      "AI_VOICE_STREAM_URL/AI_VOICE_HTTP_BASE not set; cannot notify /start-session."
    );
  }

  const url = `${AI_VOICE_HTTP_BASE}/start-session`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(3000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`/start-session non-200 response: ${resp.status} ${text}`);
  }

  console.log("[AI SESSION] Notified voice server /start-session:", {
    url,
    email: params.userEmail,
    sessionId: params.sessionId,
    folderId: params.folderId,
    total: params.total,
  });

  return true;
}

function serializeSession(doc: any | null) {
  if (!doc) return null;
  const json = typeof doc.toJSON === "function" ? doc.toJSON() : doc;

  // Map completedAt → endedAt for the frontend while keeping the original field.
  if (!json.endedAt && json.completedAt) {
    json.endedAt = json.completedAt;
  }

  // ───────────────────────── Stats normalization for the frontend ─────────────────────────
  //
  // DB stores (AICallSession.stats):
  //   stats.completed
  //   stats.booked
  //   stats.not_interested
  //   stats.no_answer
  //   stats.callback
  //   stats.do_not_call
  //   stats.disconnected
  //
  // The AI Dial Session UI expects:
  //   stats.totalLeads
  //   stats.completed
  //   stats.booked
  //   stats.notInterested
  //   stats.noAnswers
  //
  // We normalize here without changing what's in Mongo.
  const rawStats = (json.stats || {}) as any;

  const totalFromSession =
    typeof json.total === "number"
      ? json.total
      : Array.isArray(json.leadIds)
      ? json.leadIds.length
      : undefined;

  json.stats = {
    // keep any existing stats fields in case we add more later
    ...rawStats,
    // front-end friendly aliases
    totalLeads:
      rawStats.totalLeads ??
      (typeof totalFromSession === "number" ? totalFromSession : 0),
    completed: rawStats.completed ?? 0,
    booked: rawStats.booked ?? 0,
    notInterested: rawStats.notInterested ?? rawStats.not_interested ?? 0,
    noAnswers: rawStats.noAnswers ?? rawStats.no_answer ?? 0,
  };

  return json;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GetResponse>
) {
  const session = await getServerSession(req, res, authOptions);
  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email)
    return res.status(401).json({ ok: false, message: "Unauthorized" });

  await mongooseConnect();

  //
  // GET – fetch latest AI dial session (either for a folder, or active for user)
  //
  if (req.method === "GET") {
    try {
      const { folderId } = req.query as { folderId?: string };

      if (folderId) {
        if (!Types.ObjectId.isValid(folderId)) {
          return res
            .status(400)
            .json({ ok: false, message: "Invalid folderId" });
        }
        const fid = new Types.ObjectId(folderId);
        const latestDoc = await AICallSession.findOne({
          userEmail: email,
          folderId: fid,
          callDirection: { $ne: "inbound" },
          scriptKey: { $ne: "kayla_signup" },
        })
          .sort({ createdAt: -1 })
          .exec();

        const latest = serializeSession(latestDoc);
        return res.status(200).json({ ok: true, session: latest || null });
      }

      // No folderId → return most recent active session for this user
      const activeDoc = await AICallSession.findOne({
        userEmail: email,
        callDirection: { $ne: "inbound" },
        scriptKey: { $ne: "kayla_signup" },
        status: { $in: ["queued", "running", "paused"] },
      })
        .sort({ createdAt: -1 })
        .exec();

      const active = serializeSession(activeDoc);
      return res.status(200).json({ ok: true, session: active || null });
    } catch (err) {
      console.error("AI session GET error:", err);
      return res
        .status(500)
        .json({ ok: false, message: "Failed to load AI dial session" });
    }
  }

  //
  // POST – create/refresh an AI dial session for a folder
  //
  if (req.method === "POST") {
    try {
      const { folderId, mode = "fresh", fromNumber, scriptKey, voiceKey } =
        (req.body || {}) as PostBody;

      if (!folderId) {
        return res
          .status(400)
          .json({ ok: false, message: "folderId is required" });
      }
      if (!Types.ObjectId.isValid(folderId)) {
        return res
          .status(400)
          .json({ ok: false, message: "Invalid folderId" });
      }
      if (!fromNumber) {
        return res
          .status(400)
          .json({ ok: false, message: "fromNumber is required" });
      }
      if (!scriptKey) {
        return res
          .status(400)
          .json({ ok: false, message: "scriptKey is required" });
      }
      if (!voiceKey) {
        return res
          .status(400)
          .json({ ok: false, message: "voiceKey is required" });
      }

      // ✅ Normalize scriptKey BEFORE saving (this is the real fix for "wrong script")
      const normalizedScriptKey = normalizeScriptKey(scriptKey);

      // Block Kayla demo sessions from the normal AI dial session UI.
      if (normalizedScriptKey === "kayla_signup") {
        return res.status(400).json({
          ok: false,
          message: "This folder is reserved for internal demo calls and cannot be used in AI Dial Sessions.",
        });
      }

      const userDoc = await User.findOne({ email }).lean();
      const billingReady = requireBillingReady(userDoc);
      if (!userDoc || (userDoc as any).hasAI !== true || !billingReady.ok) {
        return res
          .status(403)
          .json({ ok: false, error: "AI Dialer not available for this account" });
      }

      const fid = new Types.ObjectId(folderId);

      // Pull queue snapshot from leads in that folder (per-user ownership)
      const leads = await Lead.find({
        folderId: fid,
        $or: [{ userEmail: email }, { ownerEmail: email }, { user: email }],
      })
        .sort({ aiPriorityScore: -1, createdAt: -1, lastContactedAt: 1 })
        .select("_id")
        .lean()
        .exec();

      const leadIds = leads.map((l: any) => l._id as any);
      const total = leadIds.length;

      if (total === 0) {
        return res
          .status(400)
          .json({ ok: false, message: "No leads in this folder to dial." });
      }

      let aiSession = await AICallSession.findOne({
        userEmail: email,
        folderId: fid,
        callDirection: { $ne: "inbound" },
        scriptKey: { $ne: "kayla_signup" },
      })
        .sort({ createdAt: -1 })
        .exec();

      const now = new Date();

      if (!aiSession) {
        // First time → always behave like fresh
        aiSession = new AICallSession({
          userEmail: email,
          folderId: fid,
          leadIds,
          fromNumber,
          scriptKey: normalizedScriptKey,
          voiceKey,
          total,
          lastIndex: -1,
          status: "queued",
          startedAt: now,
          completedAt: null,
          errorMessage: null,
        });
      } else {
        // Re-use existing session for this folder/user
        aiSession.leadIds = leadIds;
        aiSession.total = total;
        aiSession.fromNumber = fromNumber;
        aiSession.scriptKey = normalizedScriptKey;
        aiSession.voiceKey = voiceKey;
        aiSession.errorMessage = null;

        if (mode === "fresh") {
          aiSession.lastIndex = -1;
        }
        // mode === "resume" keeps lastIndex where it was

        aiSession.status = "queued";
        aiSession.startedAt = now;
        aiSession.completedAt = null;
      }

      await aiSession.save();

      // 🔹 Immediately notify the AI voice server so it can kick the worker
      // This is what actually starts dialing instead of leaving the session stuck at QUEUED.
      let workerKickOk = false;
      try {
        workerKickOk = await notifyVoiceServerStartSession({
          userEmail: email,
          sessionId: String((aiSession as any)?._id),
          folderId: fid.toString(),
          total,
        });
      } catch (err: any) {
        console.error(
          "[AI SESSION] Failed to notify voice server /start-session:",
          err?.message || err
        );
      }

      // Backup direct kick with targeted sessionId — handles Render cold starts where
      // notifyVoiceServerStartSession times out (3s) before Render warms up (~10-30s).
      // If both this kick and the Render kick fire, the lock prevents double processing.
      try {
        await kickWorkerForSession(String((aiSession as any)?._id));
      } catch {
        // Non-fatal — session is saved; cron is the last-resort fallback
      }

      const payload = serializeSession(aiSession);
      return res.status(200).json({ ok: true, session: payload, workerKickOk });
    } catch (err) {
      console.error("AI session POST error:", err);
      return res
        .status(500)
        .json({ ok: false, message: "Failed to create AI dial session" });
    }
  }

  //
  // PATCH – control an existing session (stop / pause / resume)
  //
  if (req.method === "PATCH") {
    try {
      const { sessionId, action } = (req.body || {}) as {
        sessionId?: string;
        action?: "stop" | "pause" | "resume";
      };

      if (!sessionId || !Types.ObjectId.isValid(sessionId)) {
        return res
          .status(400)
          .json({ ok: false, message: "Valid sessionId is required" });
      }
      if (!action) {
        return res
          .status(400)
          .json({ ok: false, message: "action is required" });
      }

      const sid = new Types.ObjectId(sessionId);
      const aiSession = await AICallSession.findOne({
        _id: sid,
        userEmail: email,
        callDirection: { $ne: "inbound" },
        scriptKey: { $ne: "kayla_signup" },
      }).exec();

      if (!aiSession) {
        return res
          .status(404)
          .json({ ok: false, message: "AI dial session not found" });
      }

      if (action === "stop") {
        aiSession.status = "stopped";
        aiSession.completedAt = new Date();
      } else if (action === "pause") {
        aiSession.status = "paused";
      } else if (action === "resume") {
        // Put it back in the worker queue
        aiSession.status = "queued";
        // Don't reset lastIndex; just resume from where it left off
      } else {
        return res
          .status(400)
          .json({ ok: false, message: "Unsupported action" });
      }

      await aiSession.save();

      if (action === "resume") {
        try {
          await kickWorkerForSession(String((aiSession as any)?._id));
        } catch {
          // Non-fatal — session is queued; cron will pick it up as fallback
        }
      }

      const payload = serializeSession(aiSession);
      return res.status(200).json({ ok: true, session: payload });
    } catch (err) {
      console.error("AI session PATCH error:", err);
      return res
        .status(500)
        .json({ ok: false, message: "Failed to update AI dial session" });
    }
  }

  return res.status(405).json({ ok: false, message: "Method not allowed" });
}

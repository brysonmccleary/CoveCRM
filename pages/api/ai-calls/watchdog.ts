// pages/api/ai-calls/watchdog.ts
//
// Safe watchdog for stuck AI dial sessions.
//
// DESIGN CONSTRAINTS (enforced here — do not relax):
//   - Never places calls directly.
//   - Only processes status="running" sessions.
//   - Never touches queued/paused/stopped/completed/error sessions.
//   - Never kicks a session with stoppedAt set.
//   - Never kicks a session with activeCallSidAt newer than 5 minutes.
//   - Never kicks the same session more than once within 8 minutes.
//   - Caps at 5 sessions per run to limit blast radius.
//   - Each kick is a targeted ?sessionId=X — the worker handles its own guards.

import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import AICallSession from "@/models/AICallSession";

const AI_DIALER_CRON_KEY = (process.env.AI_DIALER_CRON_KEY || "").trim();
const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

const BASE = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  "http://localhost:3000"
).replace(/\/$/, "");

// A session is considered stuck if a call was placed > STALE_PLACED_CALL_MS ago
// with no terminal callback. Normal calls complete in 2–8 min; 10 min is safe.
const STALE_PLACED_CALL_MS = 10 * 60 * 1000;
// Don't kick the same session again for 8 minutes.
const WATCHDOG_COOLDOWN_MS = 8 * 60 * 1000;
// Don't kick if an active call was recorded within the last 5 minutes.
const ACTIVE_CALL_GRACE_MS = 5 * 60 * 1000;
// Hard cap on sessions kicked per watchdog run.
const MAX_KICKS_PER_RUN = 5;

function isAuthorized(req: NextApiRequest): boolean {
  const bearer = (String(req.headers["authorization"] || "").match(/^Bearer\s+(.+)$/i)?.[1] || "").trim();
  const hdr = (String(req.headers["x-cron-key"] || req.headers["x-cron-secret"] || "")).trim();
  const qs = (String((req.query.key as string) || (req.query.token as string) || "")).trim();
  const provided = bearer || hdr || qs;
  if (!provided) return false;
  return (!!AI_DIALER_CRON_KEY && provided === AI_DIALER_CRON_KEY) ||
         (!!CRON_SECRET && provided === CRON_SECRET);
}

async function kickSession(sessionId: string): Promise<boolean> {
  const secret = CRON_SECRET || AI_DIALER_CRON_KEY;
  if (!secret) return false;
  const url = `${BASE}/api/ai-calls/worker?sessionId=${encodeURIComponent(sessionId)}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "x-cron-key": secret,
        "x-cron-secret": secret,
      },
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method Not Allowed" });
  }

  if (!AI_DIALER_CRON_KEY && !CRON_SECRET) {
    return res.status(500).json({ ok: false, message: "Cron auth not configured" });
  }

  if (!isAuthorized(req)) {
    return res.status(403).json({ ok: false, message: "Forbidden" });
  }

  await mongooseConnect();

  const now = Date.now();
  const stalePlacedCutoff = new Date(now - STALE_PLACED_CALL_MS);
  const watchdogCooldownCutoff = new Date(now - WATCHDOG_COOLDOWN_MS);
  const activeCallCutoff = new Date(now - ACTIVE_CALL_GRACE_MS);

  // Find sessions that are genuinely stuck:
  //   - status exactly "running" (never queued/paused/stopped/completed/error)
  //   - stoppedAt null (not explicitly stopped by user)
  //   - lastPlacedCallAt exists and is stale (was actually dialing, now stuck)
  //   - no recent watchdog kick (prevents thrash)
  //   - no active call in the last 5 minutes (call isn't still ringing)
  const candidates = await AICallSession.find({
    status: "running",
    callDirection: { $ne: "inbound" },
    scriptKey: { $ne: "kayla_signup" },
    stoppedAt: null,
    // Must have placed a call and it must be stale (>10 min with no completion)
    lastPlacedCallAt: { $ne: null, $lt: stalePlacedCutoff },
    $and: [
      // Not kicked by watchdog recently
      {
        $or: [
          { lastWatchdogKickAt: null },
          { lastWatchdogKickAt: { $lt: watchdogCooldownCutoff } },
        ],
      },
      // No active call tracked in the last 5 minutes
      {
        $or: [
          { activeCallSidAt: null },
          { activeCallSidAt: { $lt: activeCallCutoff } },
        ],
      },
    ],
  })
    .sort({ lastPlacedCallAt: 1 }) // oldest stuck first
    .limit(MAX_KICKS_PER_RUN)
    .lean();

  if (!candidates.length) {
    return res.status(200).json({ ok: true, message: "no_stuck_sessions", kicked: [] });
  }

  const kicked: string[] = [];

  for (const session of candidates) {
    const sessionId = String((session as any)._id);

    // Atomically claim this session for this watchdog run before kicking.
    // Prevents two simultaneous watchdog invocations from double-kicking.
    const claimed = await AICallSession.updateOne(
      {
        _id: (session as any)._id,
        status: "running",
        stoppedAt: null,
        $or: [
          { lastWatchdogKickAt: null },
          { lastWatchdogKickAt: { $lt: watchdogCooldownCutoff } },
        ],
      },
      { $set: { lastWatchdogKickAt: new Date() } }
    ).exec();

    if (((claimed as any)?.modifiedCount ?? 0) === 0) {
      // Another watchdog instance claimed it first
      continue;
    }

    console.log("[AI WATCHDOG] Kicking stuck running session", {
      sessionId,
      lastPlacedCallAt: (session as any).lastPlacedCallAt,
      lastWatchdogKickAt: (session as any).lastWatchdogKickAt,
    });

    await kickSession(sessionId);
    kicked.push(sessionId);
  }

  return res.status(200).json({ ok: true, kicked, total: kicked.length });
}

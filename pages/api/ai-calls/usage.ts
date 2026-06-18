// pages/api/ai-calls/usage.ts
// Endpoint called by ai-voice-server after each call.
// Per-call-minute billing has been removed — session wall-clock billing
// is handled by watchdog.ts (periodic) and session.ts (terminal).
// This endpoint is kept alive because ai-voice-server still calls it.
import type { NextApiRequest, NextApiResponse } from "next";

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

  console.log("[AI Dialer usage] received (billing no-op — session billing handles charges)", {
    userEmail,
    minutes,
    callSid,
    sessionId,
  });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true });
}

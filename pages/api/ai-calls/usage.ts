// pages/api/ai-calls/usage.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
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

    await trackAiDialerUsage({
      user,
      minutes: mins,
      vendorCostUsd: vendorCost,
    });

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

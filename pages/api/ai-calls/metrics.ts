import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import AICallRecording from "@/models/AICallRecording";

const AI_DIALER_AGENT_KEY = String(process.env.AI_DIALER_AGENT_KEY || "").trim();

function cleanCallSid(value: unknown): string {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").trim();
}

function cleanEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  if (!AI_DIALER_AGENT_KEY) {
    return res.status(500).json({ ok: false, error: "AI_DIALER_AGENT_KEY not configured" });
  }
  if (String(req.headers["x-agent-key"] || "") !== AI_DIALER_AGENT_KEY) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const callSid = cleanCallSid(req.body?.callSid);
  const userEmail = cleanEmail(req.body?.userEmail);
  const metrics = req.body?.metrics;
  if (!callSid || !metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return res.status(400).json({ ok: false, error: "callSid and metrics are required" });
  }
  if (JSON.stringify(metrics).length > 200_000) {
    return res.status(413).json({ ok: false, error: "Metrics payload too large" });
  }

  await dbConnect();
  const recording = await AICallRecording.findOne({ callSid })
    .select("_id userEmail aiCallSessionId leadId")
    .lean();
  if (!recording) return res.status(404).json({ ok: false, error: "Call recording not found" });
  if (userEmail && cleanEmail((recording as any).userEmail) !== userEmail) {
    return res.status(409).json({ ok: false, error: "Call ownership mismatch" });
  }

  const postedSessionId = String(req.body?.sessionId || "").trim();
  const postedLeadId = String(req.body?.leadId || "").trim();
  if (
    (postedSessionId && mongoose.isValidObjectId(postedSessionId) &&
      String((recording as any).aiCallSessionId || "") !== postedSessionId) ||
    (postedLeadId && mongoose.isValidObjectId(postedLeadId) &&
      String((recording as any).leadId || "") !== postedLeadId)
  ) {
    return res.status(409).json({ ok: false, error: "Call identity mismatch" });
  }

  await AICallRecording.updateOne(
    { _id: (recording as any)._id },
    { $set: { voiceMetrics: metrics, voiceMetricsUpdatedAt: new Date() } }
  );

  return res.status(200).json({ ok: true });
}

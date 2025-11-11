// /pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallLog from "@/models/CallLog";

/**
 * Twilio will POST application/x-www-form-urlencoded to this endpoint.
 * We do NOT require auth here (it's a public webhook). We key by callSid.
 * We also accept ?userEmail=<email> from the statusCallback URL.
 */

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

function toNum(n: any): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    await dbConnect();
  } catch {}

  // Twilio sends keys like CallSid, CallStatus, From, To, AnsweredBy, CallDuration, etc.
  const b: any = req.body || {};
  const callSid = String(b.CallSid || b.CallSidSid || "").trim();
  const callStatus = String(b.CallStatus || b.CallStatusStatus || "").toLowerCase(); // queued|ringing|in-progress|answered|completed|busy|failed|no-answer|canceled
  const answeredBy = typeof b.AnsweredBy === "string" ? b.AnsweredBy : undefined;   // "human" | "machine" | undefined

  if (!callSid) {
    res.status(200).json({ ok: true, ignored: true, reason: "missing CallSid" });
    return;
  }

  const userEmail = String((req.query.userEmail as string) || b.userEmail || "").toLowerCase();
  const from = typeof b.From === "string" ? b.From : undefined;
  const to = typeof b.To === "string" ? b.To : undefined;

  // Twilio provides CallDuration on completed (in seconds)
  const duration = toNum(b.CallDuration);
  const recordingUrl = typeof b.RecordingUrl === "string" ? b.RecordingUrl : undefined;

  // Derive booleans/fields
  const isFailure = callStatus === "no-answer" || callStatus === "busy" || callStatus === "failed" || callStatus === "canceled";
  const isCompleted = callStatus === "completed";
  const isAnswered = callStatus === "answered" || callStatus === "in-progress";

  // Build updates (atomic, idempotent)
  const $set: Record<string, any> = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  // Mark answered/started once we know it rang/connected
  if (isAnswered) {
    $set.startedAt = new Date(); // best-effort; Twilio start times require REST fetch for exact; good enough for charts
    $set.direction = "outbound"; // default; inbound paths set this elsewhere
    if (typeof answeredBy === "string") $set["amd.answeredBy"] = answeredBy;
  }

  if (isCompleted) {
    $set.completedAt = new Date();
    if (Number.isFinite(duration)) {
      $set.duration = duration;
      // talkTime fallback to duration if we don't compute speech-only later
      if (typeof $set.talkTime === "undefined") $set.talkTime = duration;
    }
    if (recordingUrl) $set.recordingUrl = recordingUrl;
  }

  if (isFailure) {
    // For failed/no-answer we still upsert the call with a timestamp
    $set.completedAt = new Date();
  }

  const $setOnInsert: Record<string, any> = {
    userEmail: userEmail || "(unknown)",
    callSid,
    direction: "outbound",
    ownerNumber: from,
    otherNumber: to,
    createdAt: new Date(),
  };

  try {
    await Call.updateOne({ callSid }, { $set, $setOnInsert }, { upsert: true });
  } catch (e) {
    console.error("[voice-status] Call upsert error", e);
  }

  // Write a CallLog row for final failure states (drives "No Answer" KPI)
  if (isFailure && userEmail) {
    try {
      await CallLog.create({
        userEmail,
        phoneNumber: to || "",
        direction: "outbound",
        kind: "call",
        status: callStatus === "no-answer" ? "no_answer" : callStatus,
        durationSeconds: toNum(duration),
        timestamp: new Date(),
      });
    } catch (e) {
      // ignore dupes
    }
  }

  res.status(200).json({ ok: true, callSid, status: callStatus });
}

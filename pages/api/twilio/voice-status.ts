// /pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import CallLog from "@/models/CallLog";

// Twilio posts application/x-www-form-urlencoded by default.
// Disable Next's JSON body parser and read the raw body ourselves.
export const config = {
  api: { bodyParser: false },
};

async function readFormBody(req: NextApiRequest): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  const raw = Buffer.concat(chunks).toString("utf8");
  // Accept both urlencoded and JSON just in case
  const ct = String(req.headers["content-type"] || "");
  if (/application\/json/i.test(ct)) {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  const out: Record<string, any> = {};
  const params = new URLSearchParams(raw);
  params.forEach((v, k) => { out[k] = v; });
  return out;
}

function num(n: any): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try { await dbConnect(); } catch {}

  const body = await readFormBody(req);

  // Typical fields: CallSid, CallStatus, From, To, AnsweredBy, CallDuration, RecordingUrl
  const callSid = String(body.CallSid || body.CallSidSid || "").trim();
  const callStatus = String(body.CallStatus || "").toLowerCase(); // queued|ringing|in-progress|answered|completed|busy|failed|no-answer|canceled
  const answeredBy = typeof body.AnsweredBy === "string" ? body.AnsweredBy : undefined;
  const from = typeof body.From === "string" ? body.From : undefined;
  const to = typeof body.To === "string" ? body.To : undefined;
  const duration = num(body.CallDuration);
  const recordingUrl = typeof body.RecordingUrl === "string" ? body.RecordingUrl : undefined;

  // We pass userEmail on the statusCallback URL (?userEmail=…)
  const userEmail = String((req.query.userEmail as string) || body.userEmail || "").toLowerCase();

  if (!callSid) {
    res.status(200).json({ ok: true, ignored: true, reason: "missing CallSid" });
    return;
  }

  const isFailure = ["no-answer", "busy", "failed", "canceled"].includes(callStatus);
  const isCompleted = callStatus === "completed";
  const isAnswered = callStatus === "answered" || callStatus === "in-progress" || callStatus === "bridged";

  const $set: Record<string, any> = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  // Mark start/answer quickly (twice-safe/idempotent)
  if (isAnswered || callStatus === "ringing" || callStatus === "initiated") {
    $set.startedAt = new Date();
    $set.direction = "outbound";
    if (typeof answeredBy === "string") $set["amd.answeredBy"] = answeredBy;
  }

  if (isCompleted || isFailure) {
    $set.completedAt = new Date();
    if (Number.isFinite(duration)) {
      $set.duration = duration;
      if (typeof $set.talkTime === "undefined") $set.talkTime = duration; // fallback
    }
    if (recordingUrl) $set.recordingUrl = recordingUrl;
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

  // Log terminal failures for No Answer KPI
  if (isFailure && userEmail) {
    try {
      await CallLog.create({
        userEmail,
        phoneNumber: to || "",
        direction: "outbound",
        kind: "call",
        status: callStatus === "no-answer" ? "no_answer" : callStatus,
        durationSeconds: duration,
        timestamp: new Date(),
      });
    } catch {}
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ ok: true, callSid, status: callStatus });
}

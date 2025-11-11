import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

/**
 * Helpers
 */
function firstDefined<T = any>(...vals: T[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}
function toDate(v: any): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}
function toNumber(v: any): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : undefined;
}
function prune<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = prune(v as any);
      if (Object.keys(nested).length === 0) continue;
      out[k] = nested;
    } else out[k] = v;
  }
  return out as T;
}
function normStatus(s?: string) {
  const x = String(s || "").toLowerCase();
  // Twilio sometimes posts "answered"; treat it as "in-progress" for our lifecycle
  if (x === "answered") return "in-progress";
  return x;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Twilio may send POST (form-encoded). We also accept JSON for testing.
  if (req.method !== "POST" && req.method !== "PUT") {
    return res.status(200).json({ ok: false, ignored: true, reason: "method" });
  }

  await dbConnect();

  const b = req.body || {};
  const q = req.query || {};

  // Required
  const callSid = String(firstDefined(b.callSid, b.CallSid, q.callSid, q.CallSid) || "").trim();
  if (!callSid) {
    // Return 200 so Twilio doesn’t retry but mark invalid
    return res.status(200).json({ ok: false, error: "missing_callSid" });
  }

  // Normalize primary fields from either JSON or Twilio form posts
  const status = normStatus(firstDefined(b.status, b.CallStatus, q.status, q.CallStatus));
  const rawDirection = String(firstDefined(b.direction, b.Direction, q.direction, q.Direction) || "").toLowerCase();
  const direction: "outbound" | "inbound" = rawDirection === "inbound" ? "inbound" : "outbound";

  const from = firstDefined(b.from, b.From, q.from, q.From) as string | undefined;
  const to = firstDefined(b.to, b.To, q.to, q.To) as string | undefined;

  const answeredBy = firstDefined(b.answeredBy, b.AnsweredBy, q.answeredBy, q.AnsweredBy) as string | undefined;
  const isVoicemail = typeof answeredBy === "string" ? /machine/i.test(answeredBy) : undefined;

  // Twilio sends duration as CallDuration (string seconds). Also accept JSON "duration".
  const duration =
    toNumber(firstDefined(b.duration, b.Duration, b.CallDuration, q.duration, q.CallDuration));

  // Optional direct talkTime (we still default talkTime := duration for now)
  const talkTime = toNumber(firstDefined(b.talkTime, q.talkTime));
  const startedAt = toDate(firstDefined(b.startTime, b.StartTime));
  const completedAt = toDate(firstDefined(b.endTime, b.EndTime));

  // Attribution: accept userEmail from query/body, but prefer the one already in the DB
  const userEmailParam =
    typeof b.userEmail === "string"
      ? b.userEmail.toLowerCase()
      : typeof q.userEmail === "string"
      ? String(q.userEmail).toLowerCase()
      : undefined;

  // 1) Load existing call (if any) to carry forward attribution.
  const existing = await (Call as any).findOne({ callSid }).lean();

  const userEmail = (existing?.userEmail || userEmailParam || "").toLowerCase();
  const leadId = existing?.leadId;
  const ownerNumber = existing?.ownerNumber || from;
  const otherNumber = existing?.otherNumber || to;
  const conferenceName = existing?.conferenceName;
  const effDirection: "outbound" | "inbound" = (existing?.direction || direction) as any;

  // If we still don’t have userEmail AND there’s no existing row, DO NOT create a doc.
  // This prevents orphan rows that the dashboard can’t see.
  const allowInsert = Boolean(userEmail);
  const isNewDoc = !existing;

  // Build update doc (no conflicting paths; only $set & $setOnInsert)
  const now = new Date();

  const setOnInsert = prune({
    callSid,
    userEmail: userEmail || undefined,
    direction: effDirection,
    ownerNumber,
    otherNumber,
    from,
    to,
    conferenceName,
    createdAt: now,
    kind: "call",
  });

  // Timestamps: set startedAt on first ringing/in-progress; set completedAt/endedAt on terminal
  const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);

  const set = prune({
    status,
    // keep numbers fresh if webhook provides them
    ownerNumber,
    otherNumber,
    from,
    to,
    // start when we first know it’s really ringing/in-progress
    ...(status === "ringing" || status === "in-progress"
      ? { startedAt: existing?.startedAt || startedAt || now }
      : {}),
    ...(terminal
      ? {
          completedAt: existing?.completedAt || completedAt || now,
          endedAt: existing?.endedAt || completedAt || now,
        }
      : {}),
    // durations
    duration: duration,
    durationSec: duration,
    talkTime: toNumber(firstDefined(talkTime, duration)), // simple first-pass: talkTime := duration
    // AMD / machine detection
    amd: answeredBy ? { answeredBy } : undefined,
    isVoicemail,
    updatedAt: now,
  });

  try {
    // If insert would be required but we still lack userEmail, skip creation and only attempt an update (no upsert).
    if (isNewDoc && !allowInsert) {
      await (Call as any).updateOne({ callSid }, { $set: set }, { upsert: false });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        ok: true,
        callSid,
        status,
        hadUserEmail: false,
        note: "skipped_insert_without_userEmail",
      });
    }

    await (Call as any).updateOne(
      { callSid },
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true }
    );

    // Minimal log line (helps verify in Vercel logs without noise)
    console.log(
      `[voice-status] callSid=${callSid} status=${status} hadUserEmail=${Boolean(userEmail)}`
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      callSid,
      status,
      hadUserEmail: Boolean(userEmail),
    });
  } catch (err: any) {
    console.error("[voice-status] upsert error", err?.message || err);
    // Still return 200 to avoid Twilio retries
    return res.status(200).json({ ok: false, error: "upsert_failed" });
  }
}

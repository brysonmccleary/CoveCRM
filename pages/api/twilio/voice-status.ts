import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

// Normalize different payload shapes (client JSON vs Twilio form posts)
function pick(s: any, ...keys: string[]) {
  const out: Record<string, any> = {};
  for (const k of keys) if (s?.[k] !== undefined) out[k] = s[k];
  return out;
}
function firstDefined<T = any>(...vals: T[]): T | undefined {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return undefined;
}
function toDate(v: any): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "PUT") {
    return res.status(200).json({ ok: false, ignored: true, reason: "method" });
  }

  await dbConnect();

  // Accept JSON, x-www-form-urlencoded, or querystring
  const b = req.body || {};
  const q = req.query || {};

  const callSid = String(
    firstDefined(b.callSid, b.CallSid, q.callSid, q.CallSid) || ""
  ).trim();

  if (!callSid) {
    // Return 200 so Twilio doesn’t retry, but mark invalid
    return res.status(200).json({ ok: false, error: "missing_callSid" });
  }

  const rawStatus = String(
    firstDefined(b.status, b.CallStatus, q.status, q.CallStatus) || ""
  ).toLowerCase();

  const rawDirection = String(
    firstDefined(b.direction, b.Direction, q.direction, q.Direction) || ""
  ).toLowerCase();

  const direction: "outbound" | "inbound" =
    rawDirection === "inbound" ? "inbound" : "outbound";

  const from = firstDefined(b.from, b.From, q.from, q.From) as string | undefined;
  const to = firstDefined(b.to, b.To, q.to, q.To) as string | undefined;

  const answeredBy = firstDefined(
    b.answeredBy,
    b.AnsweredBy,
    q.answeredBy,
    q.AnsweredBy
  ) as string | undefined;

  const isVoicemail =
    typeof answeredBy === "string" ? /machine/i.test(answeredBy) : undefined;

  // Optional timing fields the client may send (Twilio may not)
  const duration =
    typeof b.duration === "number" ? b.duration :
    typeof (b?.Duration as any) === "number" ? (b.Duration as number) :
    undefined;

  const talkTime =
    typeof b.talkTime === "number" ? b.talkTime : undefined;

  const startedAt = toDate(firstDefined(b.startTime, b.StartTime));
  const completedAt = toDate(firstDefined(b.endTime, b.EndTime));

  const userEmail =
    typeof b.userEmail === "string" ? b.userEmail.toLowerCase() : undefined;

  // Build atomic update without path conflicts
  const setOnInsert = prune({
    callSid,
    direction,           // fixed at creation
    userEmail,           // if client provided; harmless on insert
    createdAt: new Date(),
    kind: "call",
  });

  const set = prune({
    status: rawStatus || undefined,
    from,
    to,
    ownerNumber: from,
    otherNumber: to,
    startedAt,
    completedAt,
    duration,
    durationSec: duration,
    talkTime,
    amd: answeredBy ? { answeredBy } : undefined,
    isVoicemail,
    updatedAt: new Date(),
  });

  try {
    await (Call as any).updateOne(
      { callSid },
      { $set: set, $setOnInsert: setOnInsert },
      { upsert: true }
    );
  } catch (err: any) {
    console.error("[voice-status] upsert error", err?.message || err);
    // Still return 200 to avoid retries; dashboard can proceed on next event
    return res.status(200).json({ ok: false, error: "upsert_failed" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, callSid, status: rawStatus });
}

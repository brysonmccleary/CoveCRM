// pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";
import InboundCall from "@/models/InboundCall";

/** Helpers */
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
  // Treat "answered" as "in-progress"
  if (x === "answered") return "in-progress";
  return x;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "PUT") {
    return res.status(200).json({ ok: false, ignored: true, reason: "method" });
  }

  await dbConnect();

  const b = req.body || {};
  const q = req.query || {};

  const callSid = String(firstDefined(b.callSid, b.CallSid, q.callSid, q.CallSid) || "").trim();
  if (!callSid) return res.status(200).json({ ok: false, error: "missing_callSid" });

  const status = normStatus(firstDefined(b.status, b.CallStatus, q.status, q.CallStatus));
  const rawDirection = String(firstDefined(b.direction, b.Direction, q.direction, q.Direction) || "").toLowerCase();
  const direction: "outbound" | "inbound" = rawDirection === "inbound" ? "inbound" : "outbound";

  const from = firstDefined(b.from, b.From, q.from, q.From) as string | undefined;
  const to = firstDefined(b.to, b.To, q.to, q.To) as string | undefined;

  const answeredBy = firstDefined(b.answeredBy, b.AnsweredBy, q.answeredBy, q.AnsweredBy) as string | undefined;
  const isVoicemail = typeof answeredBy === "string" ? /machine/i.test(answeredBy) : undefined;

  // Twilio duration field; accept JSON "duration" too
  const duration = toNumber(firstDefined(b.duration, b.Duration, b.CallDuration, q.duration, q.CallDuration));
  const talkTime = toNumber(firstDefined(b.talkTime, q.talkTime)); // optional override

  const startedAt = toDate(firstDefined(b.startTime, b.StartTime));
  const completedAt = toDate(firstDefined(b.endTime, b.EndTime));

  const userEmailParam =
    typeof b.userEmail === "string"
      ? b.userEmail.toLowerCase()
      : typeof q.userEmail === "string"
      ? String(q.userEmail).toLowerCase()
      : undefined;

  // 🔎 Pull any inbound metadata (ownerEmail + leadId) for this callSid
  let inboundOwnerEmail: string | undefined;
  let inboundLeadId: string | undefined;
  try {
    const inbound = await (InboundCall as any).findOne({ callSid }).lean();
    if (inbound) {
      if (inbound.ownerEmail) inboundOwnerEmail = String(inbound.ownerEmail).toLowerCase();
      if (inbound.leadId) inboundLeadId = String(inbound.leadId);
    }
  } catch (e) {
    console.error("[voice-status] inbound lookup error", e);
  }

  // Load existing to preserve attribution
  const existing = await (Call as any).findOne({ callSid }).lean();

  const userEmail = (existing?.userEmail || userEmailParam || inboundOwnerEmail || "").toLowerCase();
  const effDirection: "outbound" | "inbound" = (existing?.direction || direction) as any;
  const leadId = existing?.leadId ? String(existing.leadId) : inboundLeadId;

  // If we’d have to insert but still lack userEmail, skip insert (prevent orphan rows)
  const allowInsert = Boolean(userEmail);
  const isNewDoc = !existing;

  const now = new Date();

  // ✅ Only include NON-overlapping fields in $setOnInsert
  const setOnInsert = prune({
    callSid,
    userEmail: userEmail || undefined,
    direction: effDirection,
    leadId: leadId || undefined,
    createdAt: now,
    kind: "call",
  });

  // ✅ All mutable/current fields go in $set
  const terminal = ["completed", "busy", "failed", "no-answer", "canceled"].includes(status);

  const set = prune({
    status,

    // keep latest numbers (do NOT duplicate in $setOnInsert)
    ownerNumber: existing?.ownerNumber || from,
    otherNumber: existing?.otherNumber || to,
    from,
    to,

    ...(status === "ringing" || status === "in-progress"
      ? { startedAt: existing?.startedAt || startedAt || now }
      : {}),

    ...(terminal
      ? {
          completedAt: existing?.completedAt || completedAt || now,
          endedAt: existing?.endedAt || completedAt || now,
        }
      : {}),

    duration: duration,
    durationSec: duration,
    talkTime: toNumber(firstDefined(talkTime, duration)),

    amd: answeredBy ? { answeredBy } : undefined,
    isVoicemail,
    updatedAt: now,

    // If we learned a leadId from InboundCall and the Call doc doesn't have one yet, attach it
    ...(leadId && !existing?.leadId ? { leadId } : {}),
  });

  try {
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

    await (Call as any).updateOne({ callSid }, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });

    console.log(
      `[voice-status] callSid=${callSid} status=${status} hadUserEmail=${Boolean(
        userEmail,
      )} leadId=${leadId || existing?.leadId || ""}`,
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, callSid, status, hadUserEmail: Boolean(userEmail) });
  } catch (err: any) {
    console.error("[voice-status] upsert error", err?.message || err);
    return res.status(200).json({ ok: false, error: "upsert_failed" });
  }
}

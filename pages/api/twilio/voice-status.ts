// /pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

type Body = {
  callSid?: string;
  status?: string; // queued | ringing | in-progress | completed | busy | failed | no-answer | canceled
  direction?: "outbound" | "inbound";
  from?: string;
  to?: string;
  userEmail?: string;          // optional; client may send
  startTime?: string | Date;   // optional ISO
  endTime?: string | Date;     // optional ISO
  duration?: number;           // seconds
  talkTime?: number;           // optional seconds (if you send it from client)
  amd?: { answeredBy?: string }; // "human" | "machine_*" etc
};

function toDate(v: string | Date | undefined): Date | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? undefined : d;
}

function prune<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    // drop empty nested objects too
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = prune(v as any);
      if (Object.keys(nested).length === 0) continue;
      out[k] = nested;
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  await dbConnect();

  const b = (req.body || {}) as Body;
  const callSid = String(b.callSid || "").trim();
  if (!callSid) return res.status(400).json({ error: "Missing callSid" });

  // Normalize inputs
  const callStatus = (b.status || "").toLowerCase();
  const direction = (b.direction as any) === "inbound" ? "inbound" : "outbound";
  const startedAt = toDate(b.startTime);
  const completedAt = toDate(b.endTime);
  const duration = typeof b.duration === "number" ? b.duration : undefined;
  const talkTime = typeof b.talkTime === "number" ? b.talkTime : undefined;
  const from = b.from;
  const to = b.to;
  const answeredBy = b.amd?.answeredBy;
  const isVoicemail =
    typeof answeredBy === "string" ? /machine/i.test(answeredBy) : undefined;

  // Build $setOnInsert ONLY for fields that should not conflict later
  const setOnInsert = prune({
    callSid,
    userEmail: b.userEmail, // if you send it; safe here only
    direction,              // direction is fixed at insert time
    createdAt: new Date(),
    kind: "call",
  });

  // Build $set for everything that may change over time
  const set = prune({
    status: callStatus || undefined,
    startedAt,
    completedAt,
    duration,
    durationSec: duration,
    talkTime,
    from,
    to,
    ownerNumber: from,
    otherNumber: to,
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
    // Return 200 so Twilio/clients don’t retry; log is enough for us.
    return res.status(200).json({ ok: false, error: "upsert_failed" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, callSid, status: callStatus });
}

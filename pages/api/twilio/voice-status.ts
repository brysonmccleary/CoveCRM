import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

/**
 * Twilio status callback hits this endpoint multiple times during a call:
 *  - ringing | in-progress | completed | busy | failed | no-answer | canceled
 * We upsert the Call by CallSid and only use $set / $setOnInsert to avoid
 * any MongoDB path conflicts (no top-level fields in the update document).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    await dbConnect();
  } catch (e) {
    // Continue; Mongoose may already be connected in the pool
  }

  // Twilio sends x-www-form-urlencoded; Next parses req.body into an object.
  // Accept both Twilio/Express field names and safe fallbacks.
  const b: any = req.body || {};

  // From start.ts we pass ?userEmail=... on the callback URL.
  const userEmail = String((req.query.userEmail || "") as string).toLowerCase() || null;

  // Twilio core fields
  const callSid = String(b.CallSid || b.CallSid || "").trim();
  const callStatus = String(b.CallStatus || b.CallStatus || "").toLowerCase(); // in-progress | completed | ...
  const from = String(b.From || b.Caller || "").trim();
  const to = String(b.To || b.Called || "").trim();

  // Twilio direction can be "outbound-api", "inbound", "outbound-dial", etc.
  const twilioDirection = String(b.Direction || b.CallDirection || "").toLowerCase();
  const mappedDirection: "outbound" | "inbound" =
    twilioDirection.includes("inbound") ? "inbound" : "outbound";

  // Optional AMD field if enabled later (won't break if missing)
  const answeredBy =
    typeof b.AnsweredBy === "string" && b.AnsweredBy ? String(b.AnsweredBy) : null;

  if (!callSid) {
    // Nothing we can do; log and exit
    console.error("[voice-status] missing CallSid", { callStatus, from, to });
    return res.status(200).json({ ok: true, ignored: true });
  }

  // Build a conflict-free upsert
  const now = new Date();

  // Always-set fields (safe to overwrite repeatedly)
  const baseSet: Record<string, any> = {
    // ownership + addressing
    userEmail: userEmail || undefined, // keep consistent casing
    from,
    to,
    ownerNumber: from || undefined,
    otherNumber: to || undefined,

    // normalize your schema direction
    direction: mappedDirection,

    // keep last-seen status & metadata for debugging
    recordingStatus: undefined, // don't touch unless you populate elsewhere
  };

  // Status-specific fields (merge into $set below)
  if (callStatus === "in-progress" || callStatus === "answered") {
    baseSet.startedAt = baseSet.startedAt || now; // first connect moment
  }

  if (callStatus === "completed" || callStatus === "busy" || callStatus === "failed" || callStatus === "no-answer" || callStatus === "canceled") {
    baseSet.completedAt = now;

    // Twilio supplies CallDuration in seconds on completed callbacks
    const durRaw = b.CallDuration ?? b.Duration ?? b.RecordingDuration;
    const dur = Number(durRaw);
    if (!Number.isNaN(dur) && dur >= 0) {
      baseSet.duration = dur;
      baseSet.durationSec = dur;
      // If you don't compute "talkTime" elsewhere, let stats fall back to duration.
      // (Your stats.ts already uses _talkTime = talkTime ?? duration)
      // baseSet.talkTime = baseSet.talkTime ?? dur; // Uncomment if you want to equate talk to total.
    }
  }

  if (answeredBy) {
    // Persist AMD hint in a subdocument—stats.ts expects amd.answeredBy later
    baseSet["amd"] = { answeredBy };
  }

  // Only ever use $set / $setOnInsert to avoid "path conflict" errors
  const update = {
    $set: baseSet,
    $setOnInsert: {
      callSid,
      createdAt: now,
      kind: "call",
    },
  };

  try {
    await (Call as any).updateOne({ callSid }, update, { upsert: true });
  } catch (err: any) {
    console.error("[voice-status] upsert error", err?.message || err);
    // Return 200 so Twilio doesn't retry forever; log is enough for us.
    return res.status(200).json({ ok: false, error: "upsert_failed" });
  }

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, callSid, status: callStatus });
}

// /pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

/**
 * Twilio calls this webhook with form-encoded fields.
 * We also pass ?userEmail=<email> in the callback URL.
 *
 * IMPORTANT: Do not require auth here; Twilio is the caller.
 * We must avoid update conflicts: never set the same path in more than one operator.
 */

function mapDirection(raw?: string): "outbound" | "inbound" {
  const d = String(raw || "").toLowerCase();
  if (d.startsWith("outbound")) return "outbound"; // outbound-api / outbound-dial
  if (d === "inbound") return "inbound";
  return "outbound";
}

function toNum(n: any): number | undefined {
  const v = Number(n);
  return Number.isFinite(v) ? v : undefined;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "1mb",
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const emailQ = String(req.query.userEmail || "").toLowerCase().trim();
  if (!emailQ) {
    // Still 200 so Twilio doesn’t retry forever.
    return res.status(200).json({ ok: false, reason: "missing userEmail" });
  }

  // Twilio posts x-www-form-urlencoded; Next parses into req.body already.
  const body = (req.body || {}) as Record<string, any>;

  const callSid = String(body.CallSid || body.CallSidSid || "").trim();
  const callStatus = String(body.CallStatus || "").toLowerCase(); // queued|ringing|in-progress|completed|busy|failed|no-answer|canceled
  const answeredBy = String(body.AnsweredBy || "").toLowerCase(); // human|machine|unknown (only if AMD enabled)
  const direction = mapDirection(body.Direction);
  const from = String(body.From || "");
  const to = String(body.To || "");
  const callDuration = toNum(body.CallDuration); // seconds (only on completed)

  if (!callSid) {
    return res.status(200).json({ ok: false, reason: "missing CallSid" });
  }

  try {
    await dbConnect();

    // $setOnInsert for invariant fields only — never repeat these in $set.
    const setOnInsert: any = {
      userEmail: emailQ,
      callSid,
      direction,           // set once on insert
      from,
      to,
      ownerNumber: from,
      otherNumber: to,
      startedAt: new Date(), // best effort
    };

    // Mutable fields go in $set only.
    const now = new Date();
    const set: any = {
      lastStatus: callStatus,
      // we intentionally DO NOT set userEmail or direction here to avoid path conflicts
    };

    // If you want to keep a simple voicemail flag when AMD says machine
    if (answeredBy) {
      set.isVoicemail = /machine/.test(answeredBy);
      // If you later add an "amd" object to the schema, set it here once.
      // set["amd"] = { answeredBy };
    }

    // Terminal statuses → mark completed & durations
    if (
      callStatus === "completed" ||
      callStatus === "busy" ||
      callStatus === "failed" ||
      callStatus === "no-answer" ||
      callStatus === "canceled"
    ) {
      set.completedAt = now;
      if (typeof callDuration === "number") {
        set.duration = callDuration;
        set.durationSec = callDuration;
        set.talkTime = callDuration; // stats use talkTime OR duration
      }
    } else if (callStatus === "in-progress") {
      // Mark a start timestamp if the doc didn’t exist (handled by $setOnInsert)
      // Nothing else required here.
    }

    // Safe upsert — filter by callSid only (unique in your model)
    await (Call as any).updateOne(
      { callSid },
      {
        $setOnInsert: setOnInsert,
        $set: set,
      },
      { upsert: true }
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, callSid, status: callStatus });
  } catch (err: any) {
    // Always 200 to stop Twilio retries; include a hint for our logs
    console.error("[voice-status] upsert error", err?.message || err);
    return res.status(200).json({ ok: false, callSid, error: "upsert_failed" });
  }
}

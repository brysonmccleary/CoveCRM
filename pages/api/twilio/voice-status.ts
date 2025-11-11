// /pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

/**
 * Twilio status callback (we currently register "completed" only).
 * We DO NOT verify signatures here (ok for now). Body is form-encoded.
 *
 * start.ts builds the callback as: /api/twilio/voice-status?userEmail=<encoded>
 * We rely on that to associate the call row to the user.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    await dbConnect();
  } catch {
    // keep going; mongoose will try again on first query
  }

  // Pull userEmail from the query (we add it when creating the call)
  const userEmail = String((req.query.userEmail || "") as string).toLowerCase();
  if (!userEmail) {
    // we still accept, but without a user we can't surface in dashboards
    // return res.status(400).json({ error: "Missing userEmail" });
  }

  // Twilio can send urlencoded or JSON depending on tooling; support both.
  const b: any = req.body || {};
  // Standard Twilio fields we care about
  const callSid: string = String(b.CallSid || b.CallSidSid || b.sid || "").trim();
  if (!callSid) {
    return res.status(200).json({ ok: true, skipped: true, reason: "no CallSid" });
  }

  // Examples:
  // b.CallStatus: queued | ringing | in-progress | completed | busy | failed | no-answer | canceled
  // b.Direction: inbound | outbound-api | outbound-dial
  // b.AnsweredBy: machine_start | human | machine | unknown (when AMD used)
  // b.CallDuration: "23" (seconds, present on completed)
  // b.From / b.To: E.164 numbers
  // b.StartTime / b.EndTime: RFC dates (on completed)
  const rawDirection = String(b.Direction || "").toLowerCase();
  const normalizedDirection =
    rawDirection.startsWith("inbound") ? "inbound" : "outbound";

  // Timestamps
  const startedAt =
    b.StartTime ? new Date(b.StartTime) : undefined;
  const completedAt =
    b.EndTime ? new Date(b.EndTime) : undefined;

  // Durations
  const durNum =
    typeof b.CallDuration === "string" && b.CallDuration.trim() !== ""
      ? Number(b.CallDuration)
      : typeof b.duration === "number"
      ? b.duration
      : undefined;

  // Numbers
  const from = typeof b.From === "string" ? b.From : undefined;
  const to = typeof b.To === "string" ? b.To : undefined;

  // Helpful routing: which is our DID vs the external number?
  let ownerNumber: string | undefined = undefined;
  let otherNumber: string | undefined = undefined;
  if (normalizedDirection === "inbound") {
    ownerNumber = to;
    otherNumber = from;
  } else {
    ownerNumber = from;
    otherNumber = to;
  }

  // Optional AMD -> voicemail flag
  const answeredBy = String(b.AnsweredBy || "").toLowerCase();
  const isVoicemail = /machine/.test(answeredBy);

  // Build single $set — no conflicting paths.
  const $set: Record<string, any> = {
    ...(userEmail ? { userEmail } : {}),
    callSid: callSid,
    direction: normalizedDirection,     // set exactly once
    from,
    to,
    ownerNumber,
    otherNumber,
  };

  if (startedAt) $set.startedAt = startedAt;
  if (completedAt) $set.completedAt = completedAt;
  if (typeof durNum === "number" && !Number.isNaN(durNum)) {
    $set.duration = durNum;
    $set.durationSec = durNum;
    $set.talkTime = durNum; // your dashboard counts connects via talkTime>=threshold
  }
  if (answeredBy) {
    $set.isVoicemail = isVoicemail;
    // If you later add an "amd" subdoc in Call, you can store the raw value there.
  }

  try {
    // Upsert by callSid. Use $set for everything; setOnInsert only for immutable seeds.
    await (Call as any).updateOne(
      { callSid },
      {
        $set,
        $setOnInsert: {
          // these are safe to set once on creation
          callSid,
          ...(userEmail ? { userEmail } : {}),
          direction: normalizedDirection,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, callSid, status: b.CallStatus || null });
  } catch (err: any) {
    console.error("[voice-status] upsert error", err?.message || err);
    return res.status(200).json({ ok: false, callSid, error: String(err?.message || err) });
  }
}

// pages/api/ai-calls/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

/**
 * Twilio status callback for AI calls.
 *
 * We call this from aiVoiceStatusUrl(req, userEmail) so we always know
 * which user the call belongs to.
 *
 * Twilio POST body (form-encoded) will contain fields like:
 *  - CallSid
 *  - CallStatus (queued|ringing|in-progress|completed|busy|no-answer|failed)
 *  - CallDuration (only on completed)
 *  - To / From
 */
export const config = {
  api: {
    bodyParser: true, // ok for Twilio webhooks unless you add signature verification
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  const userEmail = String(req.query.userEmail || "").toLowerCase();
  if (!userEmail) {
    return res.status(400).send("Missing userEmail");
  }

  const body = req.body as any;
  const callSid = body.CallSid as string | undefined;
  const status = (body.CallStatus as string | undefined) || "";
  const to = body.To as string | undefined;
  const from = body.From as string | undefined;
  const durationStr = body.CallDuration as string | undefined;

  if (!callSid) {
    return res.status(400).send("Missing CallSid");
  }

  try {
    await dbConnect();
  } catch (e) {
    console.error("AI status dbConnect error:", e);
    // Still return 200 to Twilio to avoid retry storms
  }

  const now = new Date();
  const durationSec =
    typeof durationStr === "string" && durationStr.length
      ? Number(durationStr)
      : undefined;

  const update: any = {
    userEmail,
    lastStatus: status,
    updatedAt: now,
  };

  if (to) update.to = to;
  if (from) update.from = from;

  // If Twilio says the call is completed, stamp endedAt + duration
  if (status === "completed" || status === "busy" || status === "no-answer" || status === "failed") {
    update.endedAt = now;
    if (!Number.isNaN(durationSec ?? NaN)) {
      update.durationSec = durationSec;
    }
  }

  try {
    await (Call as any).updateOne(
      { callSid },
      {
        $setOnInsert: {
          callSid,
          userEmail,
          direction: "outbound",
          createdAt: now,
          kind: "ai_call", // 🔹 mark as AI call
        },
        $set: update,
      },
      { upsert: true }
    );
  } catch (e) {
    console.error("AI status update error:", e);
    // Still 200 so Twilio doesn't spam retries
  }

  return res.status(200).send("OK");
}

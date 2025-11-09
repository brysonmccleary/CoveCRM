import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Call from "@/models/Call";
import { trackUsage } from "@/lib/billing/trackUsage";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const VOICE_COST_PER_MIN = Number(process.env.CRM_VOICE_COST_PER_MIN || 0.015);

export const config = {
  api: { bodyParser: true }, // Twilio posts form-encoded
};

function ceilMinutesFromSeconds(secondsStr?: string) {
  const s = Number(secondsStr || "0");
  if (!isFinite(s) || s <= 0) return 0;
  return Math.ceil(s / 60);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Twilio sends form fields; Next has parsed them into req.body already
    const callSid = String(req.body.CallSid || "");
    const status = String(req.body.CallStatus || "").toLowerCase(); // queued, ringing, in-progress, answered, completed, busy, failed, no-answer, canceled
    const durationSec = String(req.body.CallDuration || "0");
    const recordingUrl = String(req.body.RecordingUrl || "");
    const to = String(req.body.To || "");
    const from = String(req.body.From || "");
    const answeredBy = String(req.body.AnsweredBy || "");

    // We added userEmail on the query string in call.ts
    const email = String(req.query.userEmail || "").toLowerCase();

    if (!callSid) {
      res.status(200).end();
      return;
    }

    await dbConnect();

    // ✅ Persist status into Call doc (so dashboard has data)
    const now = new Date();

    // If the Call row doesn't exist (edge race), create a minimal one
    await Call.findOneAndUpdate(
      { callSid },
      {
        $setOnInsert: {
          callSid,
          userEmail: email || undefined,
          direction: "outbound",
          to,
          from,
          createdAt: now,
        },
        $set: {
          lastStatus: status || undefined,
          amd: answeredBy ? { answeredBy } : undefined,
        },
        ...(status === "answered" || status === "in-progress"
          ? { $set: { startedAt: now } }
          : {}),
        ...(status === "completed"
          ? {
              $set: {
                completedAt: now,
                duration: Number(durationSec || 0),
                talkTime: Number(durationSec || 0), // your stats use talkTime/ duration
                recordingUrl: recordingUrl || undefined,
              },
            }
          : {}),
      },
      { upsert: true, new: true }
    );

    // ✅ Billing (unchanged logic, just kept here)
    if (email) {
      const user = await User.findOne({ email });
      if (user) {
        const { usingPersonal } = await getClientForUser(user.email);
        if (status === "completed" && !usingPersonal) {
          const mins = ceilMinutesFromSeconds(durationSec);
          if (mins > 0) {
            await trackUsage({
              user,
              amount: mins * VOICE_COST_PER_MIN,
              source: "twilio-voice",
            });
          }
        }
      }
    }

    // Always 200 to Twilio
    res.status(200).end();
  } catch (e) {
    // Always 200 so Twilio doesn't retry
    res.status(200).end();
  }
}

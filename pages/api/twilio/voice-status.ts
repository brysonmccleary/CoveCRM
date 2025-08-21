// /pages/api/twilio/voice-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { trackUsage } from "@/lib/billing/trackUsage";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const VOICE_COST_PER_MIN = Number(process.env.CRM_VOICE_COST_PER_MIN || 0.015);

export const config = {
  api: { bodyParser: true }, // Accept form-encoded posts
};

function ceilMinutesFromSeconds(secondsStr?: string) {
  const s = Number(secondsStr || "0");
  if (!isFinite(s) || s <= 0) return 0;
  return Math.ceil(s / 60);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Twilio sends form-encoded fields; Next parses them into req.body
    const callSid = String(req.body.CallSid || "");
    const status = String(req.body.CallStatus || "");
    const durationSec = String(req.body.CallDuration || "0");

    // If you can pass userEmail as a param on your TwiML App connect or <Dial action=...>,
    // we’ll read it from the *query string* (not body) to keep it simple.
    const email = String(req.query.userEmail || "");

    if (!callSid) return res.status(200).end();

    if (!email) {
      // No user context → acknowledge, no billing.
      return res.status(200).end();
    }

    await dbConnect();
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(200).end();

    const { usingPersonal } = await getClientForUser(user.email);

    // Only bill platform-billed users on completed calls
    if (status === "completed" && !usingPersonal) {
      const mins = ceilMinutesFromSeconds(durationSec);
      if (mins > 0) {
        await trackUsage({ user, amount: mins * VOICE_COST_PER_MIN, source: "twilio_voice" });
      }
    }

    res.status(200).end();
  } catch (e) {
    // Always 200 to Twilio to avoid retries
    res.status(200).end();
  }
}

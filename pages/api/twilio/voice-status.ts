import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { trackUsage } from "@/lib/billing/trackUsage";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

// platform rate; personal/self users are not billed by CRM here
const VOICE_COST_PER_MIN = Number(process.env.CRM_VOICE_COST_PER_MIN || 0.015);

export const config = {
  api: { bodyParser: true }, // Twilio posts form-encoded; Next parses fine
};

function ceilMinutesFromSeconds(secondsStr?: string) {
  const s = Number(secondsStr || "0");
  if (!isFinite(s) || s <= 0) return 0;
  return Math.ceil(s / 60);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Twilio sends lots of fields; we only need a few
    const callSid = String(req.body.CallSid || "");
    const status = String(req.body.CallStatus || "");
    const durationSec = String(req.body.CallDuration || "0");
    const email = String(req.query.userEmail || "");

    if (!callSid) return res.status(200).end(); // ignore unknown

    if (!email) {
      // You can optionally look up by 'From' in your DB if you store mapping. For now, no billing.
      return res.status(200).end();
    }

    await dbConnect();
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(200).end();

    const { usingPersonal } = await getClientForUser(user.email);

    // Only bill platform users, and only on completed calls
    if (status === "completed" && !usingPersonal) {
      const mins = ceilMinutesFromSeconds(durationSec);
      if (mins > 0) {
        await trackUsage({ user, amount: mins * VOICE_COST_PER_MIN, source: "twilio-voice" });
      }
    }

    res.status(200).end();
  } catch {
    // Always 200 to Twilio to avoid retries
    res.status(200).end();
  }
}

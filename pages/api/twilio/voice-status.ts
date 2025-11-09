import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import CallLog from "@/models/CallLog";
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

// Map Twilio statuses to our normalized dashboard statuses
function mapStatusToLogStatus(twilioStatus: string, durationSec: number): "connected" | "no_answer" | "busy" | "failed" {
  const s = twilioStatus.toLowerCase();
  if (durationSec > 0) return "connected";
  if (s === "no-answer" || s === "ringing" || s === "queued" || s === "initiated") return "no_answer";
  if (s === "busy") return "busy";
  // includes failed, canceled, and anything else non-connected
  return "failed";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Twilio sends form-encoded fields; Next parses them into req.body
    const callSid = String(req.body.CallSid || "");
    const status = String(req.body.CallStatus || ""); // queued|initiated|ringing|in-progress|completed|busy|failed|no-answer|canceled
    const durationSecStr = String(req.body.CallDuration || "0");
    const toNumber = String(req.body.To || req.body.Called || ""); // lead/other party

    // If you can pass userEmail as a param on your TwiML App or <Dial action=...>,
    // we read it from the query string.
    const emailRaw = String(req.query.userEmail || "");
    const email = emailRaw.toLowerCase();

    if (!callSid) return res.status(200).end();

    // Always 200 to Twilio to avoid retries, but continue async work below
    // NOTE: we still await DB so that logs/billing persist reliably.
    if (!email) {
      // No user context → acknowledge, skip billing/logging (we cannot attribute it)
      return res.status(200).end();
    }

    await dbConnect();
    const user = await User.findOne({ email });
    if (!user) return res.status(200).end();

    const { usingPersonal } = await getClientForUser(user.email);

    // ----- BILLING (unchanged; only on COMPLETED & platform-billed) -----
    if (status === "completed" && !usingPersonal) {
      const mins = ceilMinutesFromSeconds(durationSecStr);
      if (mins > 0) {
        await trackUsage({
          user,
          amount: mins * VOICE_COST_PER_MIN,
          source: "twilio-voice", // ✅ correct UsageSource literal
        });
      }
    }

    // ----- DASHBOARD LOGGING (additive, 1 record per terminal status) -----
    // We only write a single CallLog when the call reaches a terminal state, so KPIs are stable:
    // completed, no-answer, busy, failed, canceled → one row per call attempt.
    const terminal = ["completed", "no-answer", "busy", "failed", "canceled"];
    if (terminal.includes(status.toLowerCase())) {
      const duration = Number(durationSecStr || "0") || 0;
      const normalized = mapStatusToLogStatus(status, duration);

      try {
        await CallLog.create({
          userEmail: email,
          phoneNumber: toNumber || "unknown",
          direction: "outbound",
          kind: "call",
          status: normalized,                // "connected" | "no_answer" | "busy" | "failed"
          durationSeconds: duration > 0 ? duration : undefined,
          timestamp: new Date(),             // store in UTC
        });
      } catch {
        // swallow to keep webhook resilient
      }
    }

    res.status(200).end();
  } catch {
    // Always 200 to Twilio to avoid retries
    res.status(200).end();
  }
}

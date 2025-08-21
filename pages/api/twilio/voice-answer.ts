// /pages/api/twilio/voice-answer.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const VoiceResponse = twilio.twiml.VoiceResponse;

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "").replace(/\/$/, "");

function normalizeE164(p?: string) {
  const digits = (p || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return p!.startsWith("+") ? p! : `+${digits}`;
}

/**
 * TwiML:
 * - If To is supplied (via Twilio Client params / App SID), <Dial> that PSTN number.
 * - Otherwise, speak a simple message (inbound/no-destination).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const to =
      (req.method === "GET" ? req.query.To : req.body?.To) ||
      (req.method === "GET" ? req.query.to : req.body?.to);

    const fromParam =
      (req.method === "GET" ? req.query.From : req.body?.From) ||
      (req.method === "GET" ? req.query.from : req.body?.from);

    const toNum = normalizeE164(Array.isArray(to) ? to[0] : (to as string | undefined));
    const fromNum = normalizeE164(Array.isArray(fromParam) ? fromParam[0] : (fromParam as string | undefined));

    const vr = new VoiceResponse();

    if (toNum) {
      const dial = vr.dial({
        callerId: fromNum || process.env.TWILIO_DEFAULT_CALLER_ID || undefined,
        // Provide status callback if you want call events
        ...(BASE_URL
          ? {
              action: `${BASE_URL}/api/twilio/voice-status`,
              method: "POST",
            }
          : {}),
      });
      dial.number({}, toNum);
    } else {
      vr.say({ voice: "Polly.Matthew-Neural" }, "This call is from Cove C R M.");
    }

    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(vr.toString());
  } catch (e) {
    const vr = new VoiceResponse();
    vr.say("An error occurred.");
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(vr.toString());
  }
}

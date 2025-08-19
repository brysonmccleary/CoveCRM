import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

const VoiceResponse = twilio.twiml.VoiceResponse;

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.BASE_URL ||
  ""
).replace(/\/$/, "");
const STATUS_CB_URL = `${BASE_URL}/api/twilio/status-callback`;
const RECORDING_CB_BASE = `${BASE_URL}/api/twilio-recording`;

function sanitizeIdentity(email: string) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 120);
}
function normalizeE164(raw?: string) {
  if (!raw) return "";
  const d = raw.replace(/\D+/g, "");
  if (!d) return "";
  if (d.startsWith("1") && d.length === 11) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (raw.startsWith("+")) return raw.trim();
  return raw.trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const p = { ...(req.query as any), ...(req.body as any) };

  const toParam: string | undefined = p.To || p.to;
  const fromParam: string | undefined = p.From || p.from;
  const leadIdParam: string | undefined = p.leadId || p.LeadId || p.leadID;

  const calledNumber: string | undefined = p.Called || p.To;

  const twiml = new VoiceResponse();

  try {
    // ---- Outbound bridge (browser → PSTN)
    if (toParam && /^\+?\d{7,15}$/.test(String(toParam))) {
      const leadNumber = normalizeE164(String(toParam));
      const callerId = normalizeE164(
        String(fromParam || process.env.TWILIO_CALLER_ID || ""),
      );

      if (!callerId) {
        twiml.say("No caller ID configured.");
      } else if (!leadNumber) {
        twiml.say("Invalid destination number.");
      } else {
        let userEmailForCb = "";
        try {
          await dbConnect();
          const owner = await User.findOne({
            "numbers.phoneNumber": callerId,
          }).lean();
          if (owner?.email) userEmailForCb = String(owner.email).toLowerCase();
        } catch {}

        const recordingCbUrl = `${RECORDING_CB_BASE}?userEmail=${encodeURIComponent(
          userEmailForCb,
        )}${leadIdParam ? `&leadId=${encodeURIComponent(leadIdParam)}` : ""}`;

        const dial = twiml.dial({
          callerId,
          answerOnBridge: true,
          record: "record-from-answer-dual",
          recordingStatusCallback: recordingCbUrl,
          recordingStatusCallbackMethod: "POST",
          recordingStatusCallbackEvent: ["completed"] as any,
        });

        dial.number(
          {
            statusCallback: STATUS_CB_URL,
            statusCallbackMethod: "POST",
            statusCallbackEvent: [
              "initiated",
              "ringing",
              "answered",
              "completed",
            ],
          } as any,
          leadNumber,
        );
      }

      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml.toString());
    }

    // ---- Inbound routing (PSTN → agent browser)
    await dbConnect();
    const owner =
      (calledNumber &&
        (await User.findOne({
          "numbers.phoneNumber": normalizeE164(calledNumber),
        }))) ||
      null;

    if (!owner) {
      twiml.say("No agent found for this number.");
      res.setHeader("Content-Type", "text/xml");
      return res.status(200).send(twiml.toString());
    }

    const identity = sanitizeIdentity(owner.email);
    const callerId = normalizeE164(
      String(calledNumber || process.env.TWILIO_CALLER_ID || ""),
    );

    const recordingCbUrl = `${RECORDING_CB_BASE}?userEmail=${encodeURIComponent(
      String(owner.email).toLowerCase(),
    )}`;

    const dial = twiml.dial({
      callerId,
      answerOnBridge: true,
      record: "record-from-answer-dual",
      recordingStatusCallback: recordingCbUrl,
      recordingStatusCallbackMethod: "POST",
      recordingStatusCallbackEvent: ["completed"] as any,
    });

    dial.client(
      {
        statusCallback: STATUS_CB_URL,
        statusCallbackMethod: "POST",
        statusCallbackEvent: [
          "initiated",
          "ringing",
          "answered",
          "completed",
        ],
      } as any,
      identity,
    );

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (err) {
    console.error("voice/answer error:", err);
    twiml.say("An error occurred.");
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  }
}

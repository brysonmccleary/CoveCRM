// pages/api/twilio/calls/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import InboundCall from "@/models/InboundCall";

const { validateRequest } = twilio;

export const config = {
  api: { bodyParser: false }, // Twilio posts x-www-form-urlencoded; read raw for signature validation
};

function resolveFullUrl(req: NextApiRequest): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string) ||
    (process.env.NEXT_PUBLIC_BASE_URL?.startsWith("https") ? "https" : "http") ||
    "https";
  const host = (req.headers["x-forwarded-host"] as string) || (req.headers.host as string);
  const path = req.url || "/api/twilio/calls/continue";
  return `${proto}://${host}${path}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // Read raw body exactly as Twilio sent it
  const rawBody = await microBuffer(req);
  const bodyStr = rawBody.toString("utf8");

  // Build params object for signature validation
  const params = new URLSearchParams(bodyStr);
  const paramsObj: Record<string, string> = {};
  params.forEach((v, k) => (paramsObj[k] = v));

  // Validate Twilio signature
  const sig = (req.headers["x-twilio-signature"] as string) || "";
  const url = resolveFullUrl(req);
  const token = process.env.TWILIO_AUTH_TOKEN || "";
  if (!token) {
    console.error("❌ Missing TWILIO_AUTH_TOKEN env");
    return res.status(500).send("Server misconfigured");
  }
  const ok = validateRequest(token, sig, url, paramsObj);
  if (!ok) {
    console.warn("🚫 Invalid Twilio signature for calls/continue");
    return res.status(403).send("Forbidden");
  }

  // --- Resolve the conference name for this live inbound leg ---
  const callSid = paramsObj["CallSid"] || "";
  const confFromQuery = (new URL(url).searchParams.get("conf") || "").trim();

  let conferenceName = confFromQuery;
  try {
    await dbConnect();
    if (!conferenceName && callSid) {
      const ic = await InboundCall.findOne({ callSid }).lean();
      // TS: lean() strips methods & typings; the field exists but isn't in the type. Cast for read.
      const icAny = ic as any;
      if (icAny?.conferenceName) conferenceName = String(icAny.conferenceName);
    }
  } catch {
    // If DB lookup fails, still return valid TwiML with a fallback conference
  }
  if (!conferenceName) {
    conferenceName = `inb-${(callSid || "unknown").slice(-10)}-${Date.now().toString(36)}`;
  }

  // --- Return TwiML that parks the caller in the conference ---
  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial({ answerOnBridge: true, timeout: 45 });
  dial.conference(
    {
      beep: "false",
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
      // waitUrl: "" // optional: add custom wait music if desired
    },
    conferenceName
  );

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}

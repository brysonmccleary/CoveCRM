// pages/api/twilio/calls/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";
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

  // Produce TwiML that redirects to your original, full call flow
  const base = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
  const voiceAnswerUrl = `${base}/api/twilio/voice-answer`; // your existing route

  const vr = new twilio.twiml.VoiceResponse();
  vr.redirect({ method: "POST" }, voiceAnswerUrl);

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}

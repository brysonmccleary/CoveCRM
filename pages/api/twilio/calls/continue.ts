// pages/api/twilio/calls/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer as microBuffer } from "micro";
import twilio from "twilio";
const { validateRequest } = twilio;

export const config = {
  api: { bodyParser: false }, // Twilio posts x-www-form-urlencoded; keep raw for signature check
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

  // raw body for signature verification
  const rawBody = await microBuffer(req);
  const bodyStr = rawBody.toString("utf8");

  // Twilio signature validation
  const params = new URLSearchParams(bodyStr);
  const paramsObj: Record<string, string> = {};
  params.forEach((v, k) => (paramsObj[k] = v));

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

  // Pull the conference name from query (answer.ts set it)
  const parsed = new URL(url);
  let conferenceName = parsed.searchParams.get("conference") || "";

  if (!conferenceName) {
    // last-resort fallback so caller doesn't get stuck
    conferenceName = `inb-fallback-${Date.now().toString(36)}`;
  }

  // TwiML: put the caller into the exact conference
  const vr = new twilio.twiml.VoiceResponse();
  const dial = vr.dial();
  dial.conference(
    {
      beep: "false",
      startConferenceOnEnter: true,   // caller should not be kept waiting once others join
      endConferenceOnExit: false,     // keep room alive for the agent to join
      waitUrl: "",                    // Twilio default if empty string; avoids extra prompts
      maxParticipants: 2
    },
    conferenceName
  );

  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(vr.toString());
}

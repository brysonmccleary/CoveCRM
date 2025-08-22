// pages/api/voice/lead-join.ts
// TwiML that connects the LEAD into the conference immediately (no hold music)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

function resolveBaseUrl(req: NextApiRequest) {
  const envBase =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    "";
  if (envBase) return envBase.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const conferenceName = (req.query.conferenceName as string) || "default";
  const base = resolveBaseUrl(req);
  const silenceUrl = `${base}/api/voice/silence`;

  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();

  dial.conference(
    {
      startConferenceOnEnter: true,  // lead starts/joins the room right away
      endConferenceOnExit: true,     // tear down when the lead leaves
      beep: false,                   // no beeps
      waitUrl: silenceUrl,           // explicit silence (no Twilio default)
      waitMethod: "POST",
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

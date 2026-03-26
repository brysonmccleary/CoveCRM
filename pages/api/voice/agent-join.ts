// pages/api/voice/agent-join.ts
// TwiML for the BROWSER leg to join the same conference (absolute silence while waiting)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

export const config = { api: { bodyParser: false } };

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
const SILENCE_URL = `${BASE_URL}/api/twiml/silence`;

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}



function identityFromTwilioFrom(fromRaw: string): string {
  const raw = String(fromRaw || "").trim();
  // Twilio Client uses From like: client:identity
  if (raw.startsWith("client:")) return raw.slice("client:".length).trim().toLowerCase();
  return raw.toLowerCase();
}
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let conferenceName = "default";
  try {
    if (req.method === "POST") {
      const raw = await readRawBody(req);
      if (raw) {
        const params = new URLSearchParams(raw);
        const fromBody = params.get("conferenceName");
        if (fromBody) conferenceName = fromBody;
        const fromBodyTwilio = params.get("From") || "";
        (req as any).__twilioFrom = fromBodyTwilio;
        const toBody = params.get("To");
        if (toBody) (req as any).__twilioTo = toBody;
        const callerIdBody = params.get("CallerId") || params.get("callerId");
        if (callerIdBody) (req as any).__twilioCallerId = callerIdBody;
      }
    }
  } catch {}

  const fromQuery = (req.query.conferenceName as string) || "";
  if ((conferenceName === "default" || !conferenceName) && fromQuery) conferenceName = fromQuery;
  // ✅ MOBILE OUTBOUND MODE (additive, does not affect browser/conference calls)
  // If Twilio posts a `To` number (from VoiceGrant + connect params), dial PSTN directly.
  const postedTo = String((req as any).__twilioTo || "").trim();
  // Safety: only treat `To` as PSTN when it is a real E.164 number.
  const postedToE164 = /^\+\d{8,16}$/.test(postedTo) ? postedTo : "";
  if (postedToE164) {
    const vr = new TwilioTwiml.VoiceResponse();
    const rawCallerId = String((req as any).__twilioCallerId || "").trim();
    const callerIdE164 = /^\+\d{8,16}$/.test(rawCallerId) ? rawCallerId : "";
    const dial = callerIdE164 ? vr.dial({ callerId: callerIdE164 } as any) : vr.dial();
    dial.number(postedToE164);
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send(vr.toString());
    return;
  }
  // ✅ SAFETY FALLBACK:
      if (!conferenceName || conferenceName === "default") {
    res.setHeader("Content-Type", "text/xml");
    res.status(200).send("<Response><Say>Missing conference.</Say><Hangup/></Response>");
    return;
  }


  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();
  try { console.log("[agent-join] final conferenceName =", conferenceName); } catch {}

  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,             // no entry/exit beep
      waitUrl: SILENCE_URL,    // absolute silence; no Twilio music
      waitMethod: "POST",
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

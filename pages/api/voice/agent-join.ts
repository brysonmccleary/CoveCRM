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
        const userEmailBody = params.get("userEmail") || "";
        if (userEmailBody) (req as any).__userEmail = userEmailBody;
        const leadIdBody = params.get("leadId") || "";
        if (leadIdBody) (req as any).__leadId = leadIdBody;
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
    const rawUserEmail = String((req as any).__userEmail || "").trim();
    // Fallback: extract email from Twilio Client identity ("client:email@example.com")
    const userEmailParam = rawUserEmail || identityFromTwilioFrom(String((req as any).__twilioFrom || ""));
    const leadIdParam = String((req as any).__leadId || "").trim();

    // answerOnBridge=true: browser leg hears ringback until lead answers (SDK fires "ringing")
    const dialOpts: any = { answerOnBridge: "true" };
    if (callerIdE164) dialOpts.callerId = callerIdE164;
    const dial = vr.dial(dialOpts);

    // statusCallback on <Number> fires PSTN leg events to voice-status.ts for billing
    if (userEmailParam) {
      let statusCallbackUrl = `${BASE_URL}/api/twilio/voice-status?userEmail=${encodeURIComponent(userEmailParam)}&billingCategory=manual_dial&legType=pstn`;
      if (leadIdParam) statusCallbackUrl += `&leadId=${encodeURIComponent(leadIdParam)}`;
      dial.number({
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: "initiated ringing answered completed",
        statusCallbackMethod: "POST",
      } as any, postedToE164);
    } else {
      dial.number(postedToE164);
    }

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

// /pages/api/twiml/voice/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";
import Twilio from "twilio";

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

function pickConferenceFromAny(req: NextApiRequest, bodyParams?: URLSearchParams) {
  // Priority: explicit body params -> query params
  const bodyConference =
    bodyParams?.get("conference") ||
    bodyParams?.get("conf") ||
    bodyParams?.get("conferenceName") ||
    "";

  const q = req.query as any;
  const queryConference =
    (typeof q?.conference === "string" && q.conference) ||
    (typeof q?.conf === "string" && q.conf) ||
    (typeof q?.conferenceName === "string" && q.conferenceName) ||
    "";

  return String(bodyConference || queryConference || "").trim();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    let bodyParams: URLSearchParams | undefined;

    if (req.method === "POST") {
      const raw = await readRawBody(req);
      if (raw) bodyParams = new URLSearchParams(raw);
    }

    const conference = pickConferenceFromAny(req, bodyParams);

    if (!conference) {
      res.setHeader("Content-Type", "text/xml");
      return res
        .status(200)
        .send(`<Response><Say>Missing conference.</Say><Hangup/></Response>`);
    }

    const twiml = new Twilio.twiml.VoiceResponse();

    // This route is typically used for the PSTN/lead leg.
    // It must join the SAME conference as the browser leg, and must be silent while waiting.
    const dial = twiml.dial({ record: "do-not-record" });

    dial.conference(
      {
        // ✅ Lead leg should NOT end the room when it disconnects.
        endConferenceOnExit: false,
        // ✅ Lead should join immediately
        startConferenceOnEnter: true,
        // ✅ No beeps
        beep: false,
        // ✅ No hold music
        waitUrl: SILENCE_URL,
        waitMethod: "POST",
      } as any,
      String(conference),
    );

    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(twiml.toString());
  } catch (e: any) {
    res.setHeader("Content-Type", "text/xml");
    return res
      .status(200)
      .send(`<Response><Say>Application error.</Say><Hangup/></Response>`);
  }
}

// TwiML for the BROWSER leg to join the same conference (absolute silence while waiting)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const SILENCE_URL = BASE_URL ? `${BASE_URL}/api/twiml/silence` : undefined;

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  let conferenceName = "";

  try {
    if (req.method === "POST") {
      const raw = await readRawBody(req);
      if (raw) {
        const p = new URLSearchParams(raw);
        conferenceName =
          p.get("conferenceName") ||
          p.get("conference") ||
          p.get("conf") ||
          "";
      }
    }
  } catch {}

  if (!conferenceName) {
    const q = req.query as Record<string, any>;
    conferenceName =
      (typeof q.conferenceName === "string" && q.conferenceName) ||
      (typeof q.conference === "string" && q.conference) ||
      (typeof q.conf === "string" && q.conf) ||
      "";
  }

  if (!conferenceName) {
    res.setHeader("Content-Type", "text/xml");
    return res.status(200).send(`<Response><Say>Missing conference.</Say><Hangup/></Response>`);
  }

  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();

  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: "false", // must be string
      ...(SILENCE_URL ? { waitUrl: SILENCE_URL, waitMethod: "POST" as const } : {}),
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

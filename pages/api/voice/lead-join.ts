// pages/api/voice/lead-join.ts
// TwiML that connects the LEAD into the conference immediately (no hold music)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

// Read raw body (bodyParser disabled)
async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Prefer POST body param, fallback to query
  let conferenceName = "default";
  try {
    if (req.method === "POST") {
      const raw = await readRawBody(req);
      if (raw) {
        const params = new URLSearchParams(raw);
        const fromBody = params.get("conferenceName");
        if (fromBody) conferenceName = fromBody;
      }
    }
  } catch {}
  const fromQuery = (req.query.conferenceName as string) || "";
  if (!conferenceName && fromQuery) conferenceName = fromQuery;

  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,   // lead starts the room so there is no “waiting”
      endConferenceOnExit: true,      // tear down when the lead leaves
      beep: false,                    // no enter/exit beeps
      waitUrl: "",                    // empty string = SILENCE until the conference starts
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

// /pages/api/voice/agent-join.ts
// TwiML for the BROWSER leg (Twilio Client) to join the same conference
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
  // Try to pull `conferenceName` from x-www-form-urlencoded body (POST), then from query
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
  } catch {
    // ignore body read errors and fall back to query/default
  }

  const fromQuery = (req.query.conferenceName as string) || "";
  if (!conferenceName && fromQuery) conferenceName = fromQuery;

  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();

  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,            // no entry/exit beep
      // Note: if you want absolute silence when waiting, provide a silent TwiML URL here.
      // waitUrl: "https://handler.twilio.com/twiml/EHxxxxxxxxxxxxxxxxxxxx", 
      // waitMethod: "POST",
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

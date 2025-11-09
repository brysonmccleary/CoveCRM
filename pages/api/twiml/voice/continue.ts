// pages/api/twiml/voice/continue.ts
import type { NextApiRequest, NextApiResponse } from "next";

export const config = {
  api: { bodyParser: false }, // Twilio posts form-encoded; we don't need JSON parsing here
};

function xml(res: NextApiResponse, body: string) {
  res.setHeader("Content-Type", "text/xml; charset=utf-8");
  return res.status(200).send(body);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Accept ?conference= or ?conf= (and POST body fallback)
    const q = req.query as Record<string, any>;
    const fromQuery =
      (typeof q.conference === "string" && q.conference) ||
      (typeof q.conf === "string" && q.conf) ||
      "";

    let fromBody = "";
    if (req.method === "POST") {
      // Twilio sends application/x-www-form-urlencoded; parse lightly
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve) => {
        (req as any).on("data", (c: Buffer) => chunks.push(c));
        (req as any).on("end", () => resolve());
      });
      const raw = Buffer.concat(chunks).toString("utf8");
      // very small parser; safe for Twilio payload sizes
      const kv = Object.fromEntries(
        raw
          .split("&")
          .map(p => p.split("=").map(decodeURIComponent))
          .map(([k, v]) => [k, v ?? ""])
      );
      if (typeof kv.conference === "string" && kv.conference) fromBody = kv.conference;
      else if (typeof kv.conf === "string" && kv.conf) fromBody = kv.conf;
    }

    const conference = (fromQuery || fromBody || "").trim();

    if (!conference) {
      // Fail closed with valid TwiML + Hangup so Twilio never plays the generic error
      return xml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Sorry, we could not locate your conference. Please try the call again.</Say>
  <Hangup/>
</Response>`
      );
    }

    // Happy path: bridge the callee into the conference
    return xml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Conference
      beep="false"
      startConferenceOnEnter="true"
      endConferenceOnExit="false"
      statusCallbackEvent="start end join leave mute hold speaker"
    >${conference}</Conference>
  </Dial>
</Response>`
    );
  } catch (e) {
    // Always return valid TwiML even on exceptions
    return xml(
      res,
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Sorry, an error occurred handling your call.</Say>
  <Hangup/>
</Response>`
    );
  }
}

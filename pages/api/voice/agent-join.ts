// pages/api/voice/agent-join.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";

export const config = { api: { bodyParser: false } };

async function readRawBody(req: NextApiRequest): Promise<string> {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function baseUrl(req: NextApiRequest) {
  const envBase = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";
  if (envBase) return envBase.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host || "localhost:3000";
  return `${proto}://${host}`;
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
      }
    }
  } catch {}

  const fromQuery = (req.query.conferenceName as string) || "";
  if (!conferenceName && fromQuery) conferenceName = fromQuery;

  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();

  const silence = `${baseUrl(req)}/api/voice/silence`;

  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      beep: false,
      waitUrl: silence,        // <- total silence while “waiting”
      waitMethod: "POST",
    } as any,
    String(conferenceName),
  );

  res.setHeader("Content-Type", "text/xml");
  res.status(200).send(vr.toString());
}

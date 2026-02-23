// pages/api/voice/agent-join.ts
// TwiML for the BROWSER leg to join the same conference (absolute silence while waiting)
import type { NextApiRequest, NextApiResponse } from "next";
import { twiml as TwilioTwiml } from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import Call from "@/models/Call";

export const config = { api: { bodyParser: false } };

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
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
      }
    }
  } catch {}

  const fromQuery = (req.query.conferenceName as string) || "";
  if ((conferenceName === "default" || !conferenceName) && fromQuery) conferenceName = fromQuery;

  // ✅ SAFETY FALLBACK:
  // If Twilio didn't provide conferenceName, infer it from the most recent active outbound call for this agent.
  // This prevents the agent joining "default" and leaving the lead stuck waiting forever.
  if (!conferenceName || conferenceName === "default") {
    try {
      const twilioFrom =
        (req as any).__twilioFrom ||
        (typeof (req.query as any)?.From === "string" ? (req.query as any).From : "");

      const identity = identityFromTwilioFrom(String(twilioFrom || ""));
      if (identity) {
        await dbConnect();

        const recent = await (Call as any)
          .findOne({
            userEmail: identity,
            conferenceName: { $exists: true, $ne: "" },
            lastStatus: { $nin: ["completed"] },
            createdAt: { $gte: new Date(Date.now() - 10 * 60 * 1000) }, // last 10 minutes
          })
          .sort({ createdAt: -1 })
          .lean();

        if (recent?.conferenceName) {
          conferenceName = String(recent.conferenceName);
          try {
            console.log("[agent-join] inferred conference", { identity, conferenceName });
          } catch {}
        } else {
          try {
            console.warn("[agent-join] no recent conference found; staying default", { identity });
          } catch {}
        }
      }
    } catch (e: any) {
      console.error("[agent-join] infer conference error:", e?.message || e);
    }
  }

  const vr = new TwilioTwiml.VoiceResponse();
  const dial = vr.dial();
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

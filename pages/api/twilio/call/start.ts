import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import { getClientForUser } from "@/lib/twilio/getClientForUser";
import { pickFromNumberForUser } from "@/lib/twilio/pickFromNumber";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const VOICE_ANSWER_URL = `${BASE}/api/twilio/voice-answer`;

// We include userEmail in the status callback URL so we can bill the right user.
function voiceStatusUrl(email: string) {
  const encoded = encodeURIComponent(email.toLowerCase());
  return `${BASE}/api/twilio/voice-status?userEmail=${encoded}`;
}

function normalize(p: string) {
  const d = (p || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return p.startsWith("+") ? p : `+${d}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const email = session.user.email.toLowerCase();
  const { to } = (req.body || {}) as { to: string };

  const toNorm = normalize(to);
  if (!toNorm) return res.status(400).json({ error: "Invalid 'to' number" });

  try {
    const { client, usingPersonal } = await getClientForUser(email);
    const from = await pickFromNumberForUser(email);
    if (!from) {
      return res.status(400).json({ error: "No outbound caller ID configured. Buy a number first." });
    }

    const call = await client.calls.create({
      to: toNorm,
      from,
      url: VOICE_ANSWER_URL,                 // TwiML played on answer
      statusCallback: voiceStatusUrl(email), // billing on completion (platform users only)
      statusCallbackEvent: ["completed"],
      record: false,
    });

    res.status(200).json({ ok: true, sid: call.sid, usingPersonal, from, to: toNorm });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Call failed" });
  }
}

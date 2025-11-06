// pages/api/twilio/voice-webhook-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const VOICE_INBOUND = `${BASE}/api/twilio/voice/inbound`;
const AUTH_TOKEN = process.env.CRON_SECRET || process.env.SYNC_SECRET; // simple guard

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  const token = (req.query.token as string) || req.headers["x-cron-token"];
  if (AUTH_TOKEN && token !== AUTH_TOKEN) return res.status(401).json({ message: "Unauthorized" });

  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !BASE) {
    return res.status(500).json({ message: "Missing env: TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/BASE_URL" });
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

  try {
    const all: any[] = [];
    let page = await client.incomingPhoneNumbers.list({ limit: 1000 });
    all.push(...page);

    // If you have more than 1000, do proper paging; for most accounts this is enough.
    let changed = 0, checked = 0;
    for (const pn of all) {
      checked++;
      const current = (pn as any).voiceUrl || "";
      if (current === VOICE_INBOUND) continue;
      await client.incomingPhoneNumbers(pn.sid).update({ voiceUrl: VOICE_INBOUND, voiceMethod: "POST" });
      changed++;
    }
    return res.status(200).json({ ok: true, checked, changed, target: VOICE_INBOUND });
  } catch (e: any) {
    console.error("❌ voice-webhook-sync:", e);
    return res.status(500).json({ ok: false, error: e?.message || "Internal error" });
  }
}

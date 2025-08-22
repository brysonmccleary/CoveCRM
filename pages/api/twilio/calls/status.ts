// pages/api/twilio/calls/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilioClient from "@/lib/twilioClient";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });
  const sid = String(req.query.sid || "");
  if (!sid) return res.status(400).json({ message: "Missing sid" });

  try {
    const call = await (twilioClient.calls as any)(sid).fetch();
    // e.g. queued | ringing | in-progress | completed | busy | failed | no-answer | canceled
    const status = String(call.status || "").toLowerCase();
    res.status(200).json({
      status,
      to: call.to || null,
      from: call.from || null,
    });
  } catch (e: any) {
    res.status(500).json({ message: "Lookup failed", error: e?.message || String(e) });
  }
}

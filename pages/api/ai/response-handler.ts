// pages/api/ai/response-handler.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ✅ This endpoint is deprecated.
  // Your real inbound SMS AI flow is handled entirely by:
  //   /api/twilio/inbound-sms
  //
  // Keeping this route as a NO-OP prevents duplicate AI sends / double-texting
  // if any old webhook or client still posts here.

  // Always ACK to prevent retries from any legacy callers.
  if (req.method !== "POST") {
    return res.status(200).json({ ok: true, deprecated: true });
  }

  try {
    return res.status(200).json({ ok: true, deprecated: true });
  } catch {
    return res.status(200).json({ ok: true, deprecated: true });
  }
}

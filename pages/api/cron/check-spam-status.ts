// pages/api/cron/check-spam-status.ts
// Carrier reputation automation is disabled until Twilio Voice Integrity is implemented.
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  return res.status(200).json({
    ok: true,
    disabled: true,
    reason: "Twilio Voice Integrity reputation checks are not implemented yet.",
    checked: 0,
    flagged: 0,
    alertsSent: 0,
    alertErrors: 0,
  });
}

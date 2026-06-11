// pages/api/cron/run-drips.ts
//
// Stub: this path is referenced in middleware.ts but the actual run-drips
// logic lives at /api/internal/run-drips.
// V2 enrollments (schedulingVersion >= 2) are handled by /api/cron/send-drip-messages.
// This file exists solely to prevent 404 errors from the middleware reference.

import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(_req: NextApiRequest, res: NextApiResponse) {
  return res.status(200).json({
    ok: true,
    message: "run-drips cron stub — V2 drip scheduling is handled by /api/cron/send-drip-messages",
    disabled: true,
  });
}

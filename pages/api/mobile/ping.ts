// pages/api/mobile/ping.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Simple health check for the mobile app to call.
  // Does NOT touch auth, Mongo, Twilio, or anything else.
  res.status(200).json({
    ok: true,
    message: "CoveCRM mobile API is alive",
    timestamp: new Date().toISOString(),
  });
}

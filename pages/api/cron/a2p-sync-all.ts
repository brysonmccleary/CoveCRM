// /pages/api/cron/a2p-sync-all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";

const CRON_SECRET = (process.env.CRON_SECRET || "").trim();

/**
 * TEMPORARY SAFE MODE
 *
 * - Authenticates with CRON_SECRET (header or ?token=)
 * - Connects to Mongo (so the function stays warm/valid)
 * - Does NOT:
 *    • Call Twilio
 *    • Send ANY emails
 *    • Mutate A2P profiles
 *
 * A2P approvals / declines are now handled purely by:
 *   - /api/a2p/status-callback  (Twilio webhooks)
 *
 * This stops the repeated decline emails and Resend 429 spam from the cron.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Allow header or query token
  const provided =
    (Array.isArray(req.headers["x-cron-secret"])
      ? req.headers["x-cron-secret"][0]
      : (req.headers["x-cron-secret"] as string | undefined)) ||
    (typeof req.query.token === "string" ? req.query.token : undefined);

  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    await mongooseConnect();

    return res.status(200).json({
      ok: true,
      mode: "safe",
      message:
        "A2P sync cron temporarily disabled. Live Twilio callbacks now handle A2P status + emails.",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("cron a2p-sync-all (safe mode) error:", e?.message || e);
    return res.status(500).json({ message: e?.message || "Cron failed" });
  }
}

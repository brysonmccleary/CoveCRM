// /pages/api/poll-new-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Legacy stub endpoint for old Google Sheets polling.
 *
 * The real Sheets import logic now lives in /api/cron/google-sheets-poll
 * plus the locked import/folder files. This endpoint exists only so the
 * existing Vercel cron entry doesn't generate 404 errors.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel Cron uses GET by default; keep it simple and safe
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    message: "poll-new-lead stub: legacy endpoint disabled; using google-sheets-poll instead.",
    timestamp: new Date().toISOString(),
  });
}

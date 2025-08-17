// pages/api/cron/twilio-daily-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { syncA2PForAllUsers } from "@/lib/twilio/syncA2P";

/**
 * Daily Twilio A2P + Numbers refresh for all users.
 * Secure this route using Vercel Cron + a secret.
 *
 * Auth options:
 *  - Preferred: set header Authorization: Bearer <VERCEL_CRON_SECRET>
 *  - Fallback: allow if X-Vercel-Cron header is present (Vercel adds this automatically)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const cronHeader = req.headers["x-vercel-cron"];
  const authHeader = req.headers.authorization || "";

  const secret = process.env.VERCEL_CRON_SECRET;
  const hasBearer = authHeader.startsWith("Bearer ") && secret && authHeader === `Bearer ${secret}`;

  if (!hasBearer && !cronHeader) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const results = await syncA2PForAllUsers(1000);
    const ok = results.filter(r => r.ok).length;
    const bad = results.length - ok;

    return res.status(200).json({
      success: true,
      total: results.length,
      ok,
      failed: bad,
      details: results,
      ranAt: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error("twilio-daily-sync error:", e?.message || e);
    return res.status(500).json({ error: e?.message || "Failed daily sync" });
  }
}

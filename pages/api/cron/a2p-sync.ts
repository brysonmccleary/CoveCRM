// /pages/api/cron/a2p-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import { syncA2PForAllUsers } from "@/lib/twilio/syncA2P";

/**
 * Cron endpoint to sync A2P status for many users.
 *
 * Secured by CRON_SECRET via checkCronAuth.
 * Optional query:
 *   - ?limit=200  (default 500)
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }

  // Cron / manual auth guard
  if (!checkCronAuth(req)) {
    return res.status(403).json({ ok: false, error: "Forbidden" });
  }

  const rawLimit = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;
  const limit = rawLimit ? Math.max(1, Math.min(1000, Number(rawLimit))) : 500;

  try {
    const results = await syncA2PForAllUsers(limit);

    console.log(
      JSON.stringify({
        msg: "a2p-sync cron run",
        limit,
        total: results.length,
        okCount: results.filter((r) => r.ok).length,
        errorCount: results.filter((r) => !r.ok).length,
      }),
    );

    return res.status(200).json({
      ok: true,
      limit,
      total: results.length,
      results,
    });
  } catch (err: any) {
    console.error("[a2p-sync cron] error", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Internal Server Error",
    });
  }
}

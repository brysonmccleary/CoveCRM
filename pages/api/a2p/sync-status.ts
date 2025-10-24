// pages/api/a2p/sync-status.ts
import type { NextApiRequest, NextApiResponse } from "next";

const CRON_SECRET = process.env.CRON_SECRET || process.env.CRON_KEY || "";

function makeBaseUrl(req: NextApiRequest) {
  // Prefer explicit env; fallback to request host
  const fromEnv =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.VERCEL_URL;
  if (fromEnv) {
    return fromEnv.startsWith("http")
      ? fromEnv.replace(/\/$/, "")
      : `https://${fromEnv.replace(/\/$/, "")}`;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const base = makeBaseUrl(req);
    const target = `${base}/api/a2p/sync`;

    // Allow BOTH:
    //  - GET ?token=CRON_SECRET   (for Vercel cron)
    //  - POST with x-cron-key     (for manual trigger)
    if (req.method === "GET") {
      const token = (req.query.token as string) || "";
      if (!CRON_SECRET || token !== CRON_SECRET) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      const r = await fetch(target, {
        method: "POST",
        headers: { "x-cron-key": CRON_SECRET },
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    }

    if (req.method === "POST") {
      const key = (req.headers["x-cron-key"] as string) || "";
      if (!CRON_SECRET || key !== CRON_SECRET) {
        return res.status(403).json({ ok: false, error: "Forbidden" });
      }
      // Forward POST to the worker just like GET does (keeps a single codepath)
      const r = await fetch(target, {
        method: "POST",
        headers: { "x-cron-key": CRON_SECRET },
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    }

    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err: any) {
    console.error("sync-status shim error:", err?.message || err);
    // Return 200 to avoid cron retries storms, but include error
    return res.status(200).json({ ok: false, error: "shim-error" });
  }
}

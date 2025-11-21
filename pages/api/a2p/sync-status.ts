// pages/api/a2p/sync-status.ts
import type { NextApiRequest, NextApiResponse } from "next";

const CRON_KEY = process.env.CRON_SECRET || process.env.CRON_KEY || "";

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
    // Only support GET and POST (cron + optional manual trigger)
    if (req.method !== "GET" && req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    if (!CRON_KEY) {
      return res
        .status(500)
        .json({ ok: false, error: "CRON_SECRET/CRON_KEY not configured" });
    }

    const base = makeBaseUrl(req);
    const target = `${base}/api/a2p/sync`;

    // Regardless of GET or POST, forward a POST to /api/a2p/sync with x-cron-key.
    const r = await fetch(target, {
      method: "POST",
      headers: { "x-cron-key": CRON_KEY },
    });

    const data = await r.json().catch(() => ({}));
    return res.status(r.status).json(data);
  } catch (err: any) {
    console.error("sync-status shim error:", err?.message || err);
    // Return 200 to avoid cron retry storms, but include error field
    return res.status(200).json({ ok: false, error: "shim-error" });
  }
}

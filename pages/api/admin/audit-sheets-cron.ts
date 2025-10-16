import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // require the same CRON_SECRET you already use elsewhere
  const provided = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
  if (!provided || provided !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
  const url = `${base.replace(/\/$/, "")}/api/admin/audit-sheets`;

  const r = await fetch(url, {
    headers: { "x-admin-secret": process.env.ADMIN_SECRET || "" },
  });
  if (!r.ok) return res.status(502).json({ ok: false, error: "audit route failed", status: r.status });

  const data = await r.json().catch(() => null) as any;
  const problems = Array.isArray(data?.entries) ? data.entries.length : 0;

  if (problems > 0) {
    // returning 500 makes the cron show as failing in Vercel so you see it
    return res.status(500).json({ ok: false, problems, entries: data.entries });
  }
  return res.status(200).json({ ok: true, problems: 0 });
}

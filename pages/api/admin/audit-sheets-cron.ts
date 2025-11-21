// pages/api/admin/audit-sheets-cron.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow GET for this cron wrapper
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Use the same cron auth logic as other cron endpoints
  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const base =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    `https://${req.headers["x-forwarded-host"] || req.headers.host}`;

  const url = `${base.replace(/\/$/, "")}/api/admin/audit-sheets`;

  const r = await fetch(url, {
    headers: { "x-admin-secret": process.env.ADMIN_SECRET || "" },
  });

  if (!r.ok) {
    return res
      .status(502)
      .json({ ok: false, error: "audit route failed", status: r.status });
  }

  const data = (await r.json().catch(() => null)) as any;
  const problems = Array.isArray(data?.entries) ? data.entries.length : 0;

  if (problems > 0) {
    // returning 500 makes the cron show as failing in Vercel so you see it
    return res.status(500).json({ ok: false, problems, entries: data.entries });
  }

  return res.status(200).json({ ok: true, problems: 0 });
}

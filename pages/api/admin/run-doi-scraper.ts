// pages/api/admin/run-doi-scraper.ts
// Admin-only proxy that triggers the DOI scraper with the server-side CRON_SECRET.
// Never exposes the secret to the browser.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";
const CRON_SECRET = process.env.CRON_SECRET || "";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Admin only" });
  }

  if (!CRON_SECRET) {
    return res.status(500).json({ error: "CRON_SECRET not configured" });
  }

  // Call the scraper endpoint server-side with the real secret
  const base = process.env.NEXTAUTH_URL || `https://${req.headers.host}`;
  try {
    const resp = await fetch(`${base}/api/cron/run-doi-scraper`, {
      headers: { "x-cron-secret": CRON_SECRET },
    });
    const data = await resp.json();
    return res.status(resp.status).json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || "Scraper request failed" });
  }
}

// lib/cronAuth.ts
import type { NextApiRequest } from "next";

export function checkCronAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || "";

  // ✅ If this was invoked by a Vercel Scheduled Function, always allow it
  // Vercel adds this header on cron runs.
  const isVercelCron = !!req.headers["x-vercel-cron"];
  if (isVercelCron) return true;

  // For manual / external hits, require the actual secret
  if (!secret) return false;

  const hdr = String(req.headers.authorization || "");
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";

  const qs = typeof req.query.token === "string" ? req.query.token : "";

  return bearer === secret || qs === secret;
}

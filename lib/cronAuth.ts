// lib/cronAuth.ts
import type { NextApiRequest } from "next";

export function checkCronAuth(req: NextApiRequest): boolean {
  // ✅ Allow official Vercel Cron Jobs by header, no token required
  const vercelHeader = req.headers["x-vercel-cron"];
  const isVercelCron =
    typeof vercelHeader === "string"
      ? vercelHeader.length > 0
      : Array.isArray(vercelHeader)
      ? vercelHeader.length > 0
      : false;

  if (isVercelCron) {
    return true;
  }

  // ✅ For manual / curl calls, still require CRON_SECRET
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const hdr = String(req.headers.authorization || "");
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";

  const qs = typeof req.query.token === "string" ? req.query.token : "";

  return bearer === secret || qs === secret;
}

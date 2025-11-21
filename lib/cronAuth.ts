// lib/cronAuth.ts
import type { NextApiRequest } from "next";

export function checkCronAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  // If we are missing a secret entirely, treat as locked down
  if (!secret) return false;

  // Allow Vercel Cron jobs by header
  const isVercelCron =
    typeof req.headers["x-vercel-cron"] === "string" &&
    req.headers["x-vercel-cron"]!.length > 0;

  if (isVercelCron) {
    return true;
  }

  const hdr = String(req.headers.authorization || "");
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";

  const qs = typeof req.query.token === "string" ? req.query.token : "";

  return bearer === secret || qs === secret;
}

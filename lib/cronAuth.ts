// lib/cronAuth.ts
import type { NextApiRequest } from "next";

/**
 * Verifies the cron token from:
 * 1) Authorization: Bearer <token>
 * 2) x-cron-secret: <token>
 * 3) ?token=<token>
 */
export function checkCronAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  // 1) Authorization: Bearer <token>
  const auth = String(req.headers.authorization || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";

  // 2) x-cron-secret header (string or array per Node's header typing)
  const hdr = req.headers["x-cron-secret"];
  const xHeader =
    Array.isArray(hdr) ? (hdr[0] ?? "") : typeof hdr === "string" ? hdr : "";

  // 3) token query param
  const qs = typeof req.query.token === "string" ? req.query.token : "";

  return bearer === secret || xHeader === secret || qs === secret;
}

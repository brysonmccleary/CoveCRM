// /lib/ipTimezone.ts
import type { NextApiRequest } from "next";

/**
 * Best-effort client IP from headers + socket. Safe for serverless.
 */
export function getClientIp(req: NextApiRequest): string | null {
  const xfwd = (req.headers["x-forwarded-for"] || "") as string;
  const ip =
    xfwd.split(",").map(s => s.trim()).find(Boolean) ||
    (req.headers["x-real-ip"] as string) ||
    (req.socket as any)?.remoteAddress ||
    null;

  if (!ip) return null;
  // Strip IPv6 prefix when proxy provides ::ffff:1.2.3.4
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

/**
 * Detect timezone from request.
 * Order of preference:
 *   1) Vercel/Edge/CDN header (if present)
 *   2) Cloudflare header (if present)
 *   3) geoip-lite lookup from IP (optional dependency)
 * Returns an IANA TZ like "America/New_York", or null.
 *
 * NOTE: geoip-lite is optional. If it's not installed, we silently skip it.
 */
export async function detectTimezoneFromReq(req: NextApiRequest): Promise<string | null> {
  // 1) Vercel Edge header
  const vercelTz = (req.headers["x-vercel-ip-timezone"] as string) || "";
  if (vercelTz && /^[A-Za-z]+\/[A-Za-z_]+/.test(vercelTz)) return vercelTz;

  // 2) Cloudflare (if you front through CF)
  const cfTz = (req.headers["cf-timezone"] as string) || "";
  if (cfTz && /^[A-Za-z]+\/[A-Za-z_]+/.test(cfTz)) return cfTz;

  // 3) geoip-lite (optional)
  try {
    const ip = getClientIp(req);
    if (!ip) return null;
    // Dynamically import so the app still runs if geoip-lite isn't installed.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const geoip = require("geoip-lite");
    const hit = geoip.lookup(ip);
    if (hit && typeof hit.timezone === "string" && hit.timezone) {
      return hit.timezone as string;
    }
  } catch {
    // ignore: optional dependency may be missing in some deploys
  }

  return null;
}

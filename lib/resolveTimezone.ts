// /lib/resolveTimezone.ts
import type { NextApiRequest } from "next";

/** Simple cookie parser (no deps) */
function getCookie(req: NextApiRequest, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return;
  const parts = raw.split(";").map((s) => s.trim());
  for (const p of parts) {
    const idx = p.indexOf("=");
    if (idx === -1) continue;
    const k = decodeURIComponent(p.slice(0, idx));
    const v = decodeURIComponent(p.slice(idx + 1));
    if (k === name) return v;
  }
}

/**
 * Resolve the best timezone for the current request.
 * Priority:
 *  1) ?tz=America/Chicago                (explicit override)
 *  2) X-App-TZ header (sent by your frontend)
 *  3) Vercel edge hint: x-vercel-ip-timezone
 *  4) Cookie: tz=America/Chicago
 *  5) Fallback: 'UTC'
 */
export function resolveTimezoneFromRequest(
  req: NextApiRequest,
  fallback = "UTC",
): string {
  // 1) explicit query override
  const qtz = typeof req.query.tz === "string" ? req.query.tz : undefined;
  if (qtz && qtz.length > 2) return qtz;

  // 2) optional header your app can send from browser
  const appTz =
    (req.headers["x-app-tz"] as string) || (req.headers["x-user-tz"] as string);
  if (appTz && appTz.length > 2) return appTz;

  // 3) Vercel provides this automatically at the edge
  const vercelTz = req.headers["x-vercel-ip-timezone"] as string | undefined;
  if (vercelTz && vercelTz.length > 2) return vercelTz;

  // 4) cookie (you can set this once on the client)
  const cookieTz = getCookie(req, "tz");
  if (cookieTz && cookieTz.length > 2) return cookieTz;

  // 5) last resort
  return fallback;
}

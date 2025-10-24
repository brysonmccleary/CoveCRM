// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const openCronPaths = new Set([
  "/api/cron/run-drips",
  "/api/cron/google-sheets-poll",
  "/api/admin/audit-sheets-cron",
  "/api/a2p/sync-status",
  "/api/a2p/sync",
  "/api/drips/drips-folder-watch",
]);

function isCronAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const headerToken = req.headers.get("x-cron-key");
  const isVercelCron = !!req.headers.get("x-vercel-cron");

  return (token && token === secret) || (headerToken && headerToken === secret) || isVercelCron;
}

export function middleware(req: NextRequest) {
  const { pathname } = new URL(req.url);

  // Allow authorized cron endpoints to pass straight through
  if (openCronPaths.has(pathname)) {
    if (isCronAuthorized(req)) return NextResponse.next();
    // Still block if not authorized
    return new NextResponse("Forbidden", { status: 403, headers: { "cache-control": "private, no-store, max-age=0" } });
  }

  // … your existing auth/guard logic for everything else …
  return NextResponse.next();
}

// If you have a matcher already, keep it. Otherwise a broad matcher is fine:
export const config = {
  matcher: ["/api/:path*"],
};

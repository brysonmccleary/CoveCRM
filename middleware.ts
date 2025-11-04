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
  // debug echo (we want this reachable while debugging)
  "/api/debug/cron-auth-echo",
]);

function isCronAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  // ✅ Accept either header name
  const headerKey = req.headers.get("x-cron-key") || "";
  const headerSecret = req.headers.get("x-cron-secret") || "";
  const headerToken = headerKey || headerSecret;

  const isVercelCron = !!req.headers.get("x-vercel-cron");

  const ok = (secret && (token === secret || headerToken === secret)) || isVercelCron;

  // Attach debug headers so we can surface them on 403
  (req as any)._cron_dbg = {
    path: url.pathname,
    queryTokenPresent: token !== "",
    queryTokenLen: token.length,
    headerKeyPresent: headerKey !== "",
    headerKeyLen: headerKey.length,
    headerSecretPresent: headerSecret !== "",
    headerSecretLen: headerSecret.length,
    vercelCronHeader: isVercelCron,
    secretLenServer: secret.length,
  };

  return ok;
}

export function middleware(req: NextRequest) {
  const { pathname } = new URL(req.url);

  // 🔒 Critical: never let middleware touch websocket upgrade paths.
  if (pathname === "/api/socket" || pathname.startsWith("/api/socket/")) {
    return NextResponse.next();
  }

  if (openCronPaths.has(pathname)) {
    if (isCronAuthorized(req)) {
      return NextResponse.next();
    }
    const dbg = (req as any)._cron_dbg || {};
    return new NextResponse("Forbidden", {
      status: 403,
      headers: {
        "cache-control": "private, no-store, max-age=0",
        "x-cron-path": String(dbg.path || pathname),
        "x-cron-query-token-present": String(!!dbg.queryTokenPresent),
        "x-cron-query-token-len": String(dbg.queryTokenLen ?? 0),
        "x-cron-header-key-present": String(!!dbg.headerKeyPresent),
        "x-cron-header-key-len": String(dbg.headerKeyLen ?? 0),
        "x-cron-header-secret-present": String(!!dbg.headerSecretPresent),
        "x-cron-header-secret-len": String(dbg.headerSecretLen ?? 0),
        "x-cron-vercel-header": String(!!dbg.vercelCronHeader),
        "x-cron-secret-len": String(dbg.secretLenServer ?? 0),
      },
    });
  }

  return NextResponse.next();
}

// ✅ Keep matcher simple; exclusions are handled above.
export const config = {
  matcher: ["/api/:path*"],
};

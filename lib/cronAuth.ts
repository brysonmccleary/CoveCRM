// lib/cronAuth.ts
import type { NextApiRequest } from "next";

export function checkCronAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  const internal = process.env.INTERNAL_API_TOKEN || "";

  // If nothing is configured, fail closed.
  if (!secret && !internal) {
    return false;
  }

  // Query token (?token=...)
  const qs =
    typeof req.query.token === "string" ? (req.query.token as string) : "";

  // Optional custom headers for tokens
  const rawKey = req.headers["x-cron-key"];
  const rawSecret = req.headers["x-cron-secret"];

  const headerKey =
    typeof rawKey === "string" ? rawKey : Array.isArray(rawKey) ? rawKey[0] : "";
  const headerSecret =
    typeof rawSecret === "string"
      ? rawSecret
      : Array.isArray(rawSecret)
      ? rawSecret[0]
      : "";
  const headerToken = headerKey || headerSecret;

  // Authorization: Bearer <TOKEN>
  const rawAuth = String(req.headers.authorization || "");
  const lowerAuth = rawAuth.toLowerCase();
  const bearer =
    lowerAuth.startsWith("bearer ") ? rawAuth.slice(7).trim() : "";

  // Vercel cron marker header. We treat this as "ok" because the
  // middleware is already guarding these routes by CRON_SECRET.
  const isVercelCron = !!req.headers["x-vercel-cron"];

  const allowedTokens: string[] = [];
  if (secret) allowedTokens.push(secret);
  if (internal) allowedTokens.push(internal);

  if (isVercelCron) {
    return true;
  }

  if (qs && allowedTokens.includes(qs)) return true;
  if (headerToken && allowedTokens.includes(headerToken)) return true;
  if (bearer && allowedTokens.includes(bearer)) return true;

  return false;
}

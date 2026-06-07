import type { NextApiRequest, NextApiResponse } from "next";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const store = ((globalThis as any).__coveRateLimitStore ||= new Map<string, RateLimitEntry>()) as Map<
  string,
  RateLimitEntry
>;

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function getClientIp(req: Pick<NextApiRequest, "headers" | "socket"> | any) {
  const forwarded = firstHeader(req.headers?.["x-forwarded-for"]);
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = firstHeader(req.headers?.["x-real-ip"]);
  if (realIp) return realIp.trim();

  return req.socket?.remoteAddress || "unknown";
}

export function consumeRateLimit({ key, limit, windowMs }: RateLimitOptions) {
  const now = Date.now();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: now + windowMs };
  }

  if (current.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: current.resetAt };
  }

  current.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - current.count), resetAt: current.resetAt };
}

export function sendRateLimited(res: NextApiResponse, resetAt: number) {
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader("Retry-After", String(retryAfter));
  return res.status(429).json({ message: "Too many requests. Please try again shortly." });
}

export function enforceRateLimit(
  req: NextApiRequest,
  res: NextApiResponse,
  options: Omit<RateLimitOptions, "key"> & { keyPrefix: string; subject?: string },
) {
  const subject = options.subject ? options.subject.toLowerCase().trim() : "";
  const ip = getClientIp(req);
  const key = `${options.keyPrefix}:${ip}:${subject}`;
  const result = consumeRateLimit({ key, limit: options.limit, windowMs: options.windowMs });
  if (!result.allowed) {
    sendRateLimited(res, result.resetAt);
    return false;
  }
  return true;
}

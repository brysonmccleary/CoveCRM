import type { NextApiRequest } from "next";

export function checkCronAuth(req: NextApiRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;

  const hdr = String(req.headers.authorization || "");
  const bearer = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";

  const qs = typeof req.query.token === "string" ? req.query.token : "";
  return bearer === secret || qs === secret;
}

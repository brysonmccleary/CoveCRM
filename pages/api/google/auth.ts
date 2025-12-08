// /pages/api/google/auth.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { google } from "googleapis";

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

function getOrigin(req: NextApiRequest): string {
  const xfProto = (req.headers["x-forwarded-proto"] as string) || "https";
  const xfHost =
    (req.headers["x-forwarded-host"] as string) || req.headers.host || "";
  if (xfHost) return `${xfProto}://${xfHost}`;
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000";
  return base.replace(/\/$/, "");
}

function isHostAllowed(host: string): boolean {
  const allow = (
    process.env.OAUTH_ALLOWED_HOSTS || "covecrm.com,localhost:3000,ngrok.app"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allow.some(
    (rule) =>
      host === rule ||
      (rule.startsWith("*.")
        ? host.endsWith(rule.slice(1))
        : host.endsWith(rule)),
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ message: "Method not allowed" });

  const origin = getOrigin(req);
  try {
    const { hostname } = new URL(origin);
    if (!isHostAllowed(hostname)) {
      const base =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.BASE_URL ||
        "https://covecrm.com";
      const { hostname: hb } = new URL(base);
      if (!isHostAllowed(hb)) {
        return res.status(400).json({ message: "OAuth host not allowlisted" });
      }
    }
  } catch {
    return res.status(400).json({ message: "Invalid origin" });
  }

  const redirectUri = `${origin}/api/google/callback`;

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    redirectUri,
  );

  const userEmail = (
    req.query.userEmail ? String(req.query.userEmail) : ""
  ).toLowerCase();
  const state = userEmail
    ? Buffer.from(JSON.stringify({ userEmail }), "utf8").toString("base64url")
    : undefined;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    ...(state ? { state } : {}),
  });

  return res.status(200).json({ url: authUrl });
}

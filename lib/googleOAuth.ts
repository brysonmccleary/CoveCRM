// /lib/googleOAuth.ts
import { google } from "googleapis";

export type GoogleTarget = "calendar" | "sheets" | "both";

const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

const SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  // If you only write user-created files, drive.file is a safe narrow scope:
  // "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
  "openid",
];

function getBaseUrl() {
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000"
  );
}

export function getOAuthClient() {
  const base = getBaseUrl();
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${base}/api/google-auth/callback`,
  );
}

export function buildScopes(target: GoogleTarget = "calendar") {
  if (target === "sheets") return SHEETS_SCOPES;
  if (target === "both") return Array.from(new Set([...CALENDAR_SCOPES, ...SHEETS_SCOPES]));
  return CALENDAR_SCOPES; // default
}

export function getAuthUrl(target: GoogleTarget = "calendar") {
  const client = getOAuthClient();
  const scope = buildScopes(target);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope,
  });
}

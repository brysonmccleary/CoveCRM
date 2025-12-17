// /lib/googleOAuth.ts
import { google } from "googleapis";

export type GoogleTarget = "calendar" | "sheets" | "both";

const CALENDAR_SCOPES = [
  // Calendar (full access so consent wording matches Cloud Console + Google review)
  "https://www.googleapis.com/auth/calendar",
  // Identity
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

const SHEETS_SCOPES = [
  // Sheets + minimal Drive for listing & accessing user-selected files
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  // Identity
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

// For a "comprehensive" consent screen demo (matches Cloud Console list)
const BOTH_SCOPES = Array.from(new Set([...CALENDAR_SCOPES, ...SHEETS_SCOPES]));

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
  if (target === "both") return BOTH_SCOPES;
  return CALENDAR_SCOPES; // default calendar-only
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

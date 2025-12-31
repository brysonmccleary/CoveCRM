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

// NOTE:
// We no longer use Google Sheets / Drive OAuth scopes.
// Sheets imports are handled via the user-installed Google Apps Script posting to our webhook.
// We keep the target enum for backwards-compat with any older code paths, but it maps to calendar-only.
const SHEETS_SCOPES: string[] = [];

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
  // Backwards-compat: any legacy "sheets" / "both" requests must not request restricted scopes.
  if (target === "sheets") return CALENDAR_SCOPES;
  if (target === "both") return CALENDAR_SCOPES;
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

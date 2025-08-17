import { google } from "googleapis";

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });
}

export const SCOPES = (process.env.GOOGLE_SCOPES || "").split(" ");

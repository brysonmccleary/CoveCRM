// /pages/api/connect/google-sheets.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Google Sheets OAuth is no longer used.
 * Sheets syncing/import is handled via a user-installed Google Apps Script that POSTs rows to CoveCRM webhooks.
 *
 * We keep this route to avoid breaking any legacy UI links, but it will not request any Google restricted scopes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    error: "Google Sheets OAuth no longer supported",
    message:
      "CoveCRM no longer uses Google Sheets/Drive OAuth. Sheets imports are handled via a user-installed Google Apps Script that sends rows to CoveCRM via webhook.",
  });
}

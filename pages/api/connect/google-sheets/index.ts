// /pages/api/connect/google-sheets/index.ts
import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Legacy route kept for backwards compatibility.
 * Sheets OAuth is no longer used; we return 410 so we do not request restricted scopes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    error: "Google Sheets OAuth no longer supported",
    message:
      "CoveCRM no longer uses Google Sheets/Drive OAuth. Sheets imports are handled via a user-installed Google Apps Script that sends rows to CoveCRM via webhook.",
  });
}

// pages/api/cron/run-doi-scraper.ts
// Cron endpoint that runs the DOI scraper inline (no child process).
// Protected by cronAuth — same pattern as all other cron endpoints.
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import { scrapeAllStates } from "@/scripts/scrape-doi";

export const config = {
  // Scraping 50 states with 1.5s delays takes ~75-100s
  maxDuration: 300,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  console.info("[run-doi-scraper] Starting daily DOI scrape…");

  try {
    const result = await scrapeAllStates();

    console.info(
      `[run-doi-scraper] Completed. Imported=${result.totalImported} Updated=${result.totalUpdated} Skipped=${result.totalSkipped} Errors=${result.totalErrors}`
    );

    return res.status(200).json({
      ok: true,
      totalScraped: result.totalScraped,
      totalImported: result.totalImported,
      totalInserted: result.totalInserted,
      totalUpdated: result.totalUpdated,
      totalSkipped: result.totalSkipped,
      totalErrors: result.totalErrors,
      stateCount: Object.keys(result.byState).length,
      byState: result.byState,
    });
  } catch (err: any) {
    console.error("[run-doi-scraper] Fatal error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Scrape failed",
    });
  }
}

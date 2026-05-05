// pages/api/cron/run-doi-intelligence.ts
// Master DOI intelligence pipeline cron.
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import { scrapeAllStates } from "@/scripts/scrape-doi";
import { reEnrichAgentsBatch } from "@/scripts/re-enrich-doi";
import { runDoiPipeline } from "@/scripts/run-doi-pipeline";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  try {
    const scrape = await scrapeAllStates();
    const pipeline = await runDoiPipeline();
    const reenrich = await reEnrichAgentsBatch();

    return res.status(200).json({
      ok: true,
      scrape,
      pipeline,
      reenrich,
    });
  } catch (err: any) {
    console.error("[cron/run-doi-intelligence] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "pipeline failed" });
  }
}

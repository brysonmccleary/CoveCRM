// pages/api/cron/run-doi-pipeline.ts
// Runs the end-to-end DOI enrichment orchestrator on a schedule.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { runDoiPipeline } from "@/scripts/run-doi-pipeline";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  try {
    const summary = await runDoiPipeline();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/run-doi-pipeline] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Pipeline failed" });
  }
}

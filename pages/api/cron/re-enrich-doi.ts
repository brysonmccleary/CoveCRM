// pages/api/cron/re-enrich-doi.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import { reEnrichAgentsBatch } from "@/scripts/re-enrich-doi";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const summary = await reEnrichAgentsBatch();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/re-enrich-doi] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "re-enrich failed" });
  }
}

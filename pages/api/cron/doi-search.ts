// pages/api/cron/doi-search.ts
// Cron endpoint for search query + result harvesting.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { searchAgentsBatch } from "@/scripts/search-agent-web";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  try {
    const summary = await searchAgentsBatch();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/doi-search] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Search failed" });
  }
}

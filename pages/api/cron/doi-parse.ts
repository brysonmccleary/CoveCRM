// pages/api/cron/doi-parse.ts
// Cron endpoint for fetching/parsing DOI discovery pages.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { parseAgentPages } from "@/scripts/parse-agent-pages";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  try {
    const summary = await parseAgentPages();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/doi-parse] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Parse failed" });
  }
}

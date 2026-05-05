// pages/api/cron/score-doi-discovery.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { scoreAgentDiscovery } from "@/scripts/score-agent-discovery";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  try {
    const summary = await scoreAgentDiscovery();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/score-doi-discovery] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Scoring failed" });
  }
}

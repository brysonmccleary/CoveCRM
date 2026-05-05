// pages/api/facebook/global-intelligence/recompute.ts
// Protected recompute entrypoint for anonymized global Facebook ad intelligence.
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import { recomputeGlobalPatterns } from "@/lib/facebook/globalIntelligence/recomputeGlobalPatterns";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const limit =
      typeof req.query.limit === "string" && req.query.limit
        ? Math.min(10000, Math.max(1, Number(req.query.limit) || 5000))
        : 5000;
    const summary = await recomputeGlobalPatterns({ limit });
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[global-intelligence/recompute] failed:", err?.message);
    return res.status(500).json({ ok: false, error: "Failed to recompute global intelligence" });
  }
}

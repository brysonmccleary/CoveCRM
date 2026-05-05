// pages/api/cron/doi-resolve.ts
// Cron endpoint for identity resolution and domain selection.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { resolveIdentitiesBatch } from "@/scripts/resolve-agent-identity";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  try {
    const summary = await resolveIdentitiesBatch();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/doi-resolve] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "Resolve failed" });
  }
}

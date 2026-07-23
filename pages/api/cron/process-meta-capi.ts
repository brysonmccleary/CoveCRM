import type { NextApiRequest, NextApiResponse } from "next";
import { processPendingMetaCapiEvents } from "@/lib/meta/capi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const supplied = String(req.headers["x-cron-key"] || req.query.key || "");
  if (!process.env.CRON_SECRET || supplied !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await processPendingMetaCapiEvents(Number(req.query.limit) || 50);
    return res.status(200).json({ ok: true, ...result });
  } catch (error: any) {
    return res.status(500).json({ ok: false, error: error?.message || "CAPI processing failed" });
  }
}

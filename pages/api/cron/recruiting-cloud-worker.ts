import type { NextApiRequest, NextApiResponse } from "next";
import { processRecruitingCloudWork } from "@/lib/recruiting/cloud/worker";

export const config = { maxDuration: 300 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const supplied = String(req.headers["x-cron-key"] || req.query.key || req.headers.authorization?.replace(/^Bearer\s+/i, "") || "");
  if (!process.env.CRON_SECRET || supplied !== process.env.CRON_SECRET) return res.status(401).json({ error: "Unauthorized" });
  try {
    return res.status(200).json({ ok: true, ...(await processRecruitingCloudWork(Number(req.query.limit) || 10)) });
  } catch {
    return res.status(500).json({ ok: false, error: "Recruiting could not be processed right now." });
  }
}

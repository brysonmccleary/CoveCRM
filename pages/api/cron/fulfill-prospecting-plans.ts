// pages/api/cron/fulfill-prospecting-plans.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import { fulfillProspectingPlans } from "@/scripts/fulfill-prospecting-plans";

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const limit = Number(req.query.limit || "") || undefined;

  try {
    const summary = await fulfillProspectingPlans(limit);
    return res.status(200).json({ ok: true, summary });
  } catch (err: any) {
    console.error("[cron/fulfill-prospecting-plans] Fatal error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "fulfillment failed" });
  }
}

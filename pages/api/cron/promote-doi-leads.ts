// pages/api/cron/promote-doi-leads.ts
// Moves verified DOI agent emails into the DOILead pool.
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { checkCronAuth } from "@/lib/cronAuth";
import { promoteVerifiedAgents } from "@/scripts/promote-verified-to-doilead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!checkCronAuth(req)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  try {
    const summary = await promoteVerifiedAgents();
    return res.status(200).json({ ok: true, ...summary });
  } catch (err: any) {
    console.error("[cron/promote-doi-leads] Fatal error:", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Promotion failed",
    });
  }
}

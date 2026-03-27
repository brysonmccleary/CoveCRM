// pages/api/admin/import-leads-now.ts
// Admin-only POST: triggers FL and/or TX lead imports on demand.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { importFloridaLeads, importTexasLeads, StateImportResult } from "@/scripts/scrape-doi";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export const config = {
  maxDuration: 300,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || session.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { states } = req.body as { states?: string[] };
  if (!Array.isArray(states) || states.length === 0) {
    return res.status(400).json({ error: "Provide states array, e.g. [\"FL\", \"TX\"]" });
  }

  await mongooseConnect();

  const results: Record<string, StateImportResult> = {};

  for (const state of states) {
    const s = state.toUpperCase();
    if (s === "FL") {
      console.info("[import-leads-now] Importing Florida…");
      results["FL"] = await importFloridaLeads();
    } else if (s === "TX") {
      console.info("[import-leads-now] Importing Texas…");
      results["TX"] = await importTexasLeads();
    } else {
      results[s] = { imported: 0, updated: 0, skipped: 0, errors: 0 };
    }
  }

  return res.status(200).json({ ok: true, results });
}

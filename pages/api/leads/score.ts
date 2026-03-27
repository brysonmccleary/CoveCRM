// pages/api/leads/score.ts
// POST — score a lead and update its record
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { scoreLeadOnArrival, LeadSource } from "@/lib/leads/scoreLead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const { leadId, source } = req.body as { leadId?: string; source?: string };
  if (!leadId) return res.status(400).json({ error: "leadId is required" });

  const result = await scoreLeadOnArrival(leadId, (source || "manual") as LeadSource);
  return res.status(200).json(result);
}

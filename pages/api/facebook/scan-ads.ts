// pages/api/facebook/scan-ads.ts
// POST { leadType } — scans FB Ad Library and stores results
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { scanAdLibraryForLeadType } from "@/lib/facebook/scanAdLibrary";
import FBAdIntelligence from "@/models/FBAdIntelligence";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType } = req.body as { leadType?: string };
  if (!leadType) return res.status(400).json({ error: "leadType is required" });

  await mongooseConnect();

  const patterns = await scanAdLibraryForLeadType(leadType);

  const ads = await FBAdIntelligence.find({ leadType, active: true })
    .sort({ performanceRating: -1 })
    .limit(10)
    .lean();

  return res.status(200).json({ ok: true, ads, count: ads.length });
}

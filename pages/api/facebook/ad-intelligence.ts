// pages/api/facebook/ad-intelligence.ts
// GET ?leadType=final_expense — returns stored ad intelligence for a lead type
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBAdIntelligence from "@/models/FBAdIntelligence";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { leadType } = req.query as { leadType?: string };
  if (!leadType) return res.status(400).json({ error: "leadType is required" });

  await mongooseConnect();

  const ads = await FBAdIntelligence.find({ leadType, active: true })
    .sort({ performanceRating: -1 })
    .limit(20)
    .lean();

  return res.status(200).json({ ads });
}

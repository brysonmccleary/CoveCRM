// pages/api/facebook/global-intelligence/index.ts
// Authenticated, anonymized aggregate insights only. No user-level campaign data.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import { isExperimentalAdminEmail } from "@/lib/isExperimentalAdmin";
import mongooseConnect from "@/lib/mongooseConnect";
import FBGlobalAdPattern from "@/models/FBGlobalAdPattern";

function sampleBucket(totalCampaigns: number): string {
  if (totalCampaigns >= 25) return "large";
  if (totalCampaigns >= 10) return "medium";
  if (totalCampaigns >= 3) return "small";
  return "learning";
}

function labelFor(pattern: any): string {
  return [
    pattern.hookType,
    pattern.bodyAngle,
    pattern.offerType,
    pattern.qualifierAngle !== "none" ? pattern.qualifierAngle : "",
  ]
    .filter(Boolean)
    .join(" / ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!isExperimentalAdminEmail(session?.user?.email)) return res.status(403).json({ error: 'Forbidden' });
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const filter: Record<string, any> = {};
  if (typeof req.query.leadType === "string" && req.query.leadType.trim()) {
    filter.leadType = req.query.leadType.trim();
  }
  if (typeof req.query.status === "string" && req.query.status.trim()) {
    filter.status = req.query.status.trim();
  } else {
    filter.status = { $in: ["winner", "promising", "fatigued"] };
  }

  const limit =
    typeof req.query.limit === "string" && req.query.limit
      ? Math.min(50, Math.max(1, Number(req.query.limit) || 12))
      : 12;

  const patterns = await (FBGlobalAdPattern as any)
    .find(filter)
    .sort({ status: 1, confidenceScore: -1, performanceScore: -1, updatedAt: -1 })
    .limit(limit)
    .select(
      "leadType status performanceScore confidenceScore avgCpl avgCostPerAppointment avgCostPerSale hookType bodyAngle offerType qualifierAngle imagePromptStyle generationHints totalCampaigns updatedAt"
    )
    .lean();

  return res.status(200).json({
    ok: true,
    patterns: patterns.map((p: any) => ({
      leadType: p.leadType,
      patternLabel: labelFor(p),
      status: p.status,
      performanceScore: p.performanceScore,
      confidenceScore: p.confidenceScore,
      avgCpl: p.avgCpl,
      avgCostPerAppointment: p.avgCostPerAppointment,
      avgCostPerSale: p.avgCostPerSale,
      bestHookSummary: p.generationHints?.preferredHooks?.[0] || p.hookType || "",
      bestCtaSummary: p.generationHints?.preferredButtonLabels?.[0] || "",
      bestImageStyleSummary: p.generationHints?.preferredImageStyleNotes?.[0] || p.imagePromptStyle || "",
      antiPatternSummaries: p.generationHints?.antiPatterns || [],
      sampleSizeBucket: sampleBucket(Number(p.totalCampaigns || 0)),
      updatedAt: p.updatedAt,
    })),
  });
}

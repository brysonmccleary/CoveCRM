// pages/api/leads/source-stats.ts
// GET — return lead source ROI stats for the last 3 months
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import LeadSourceStat from "@/models/LeadSourceStat";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  // Get last 3 months
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d.toISOString().slice(0, 7));
  }

  const stats = await LeadSourceStat.find({
    userEmail: session.user.email.toLowerCase(),
    month: { $in: months },
  }).lean();

  // Aggregate by source
  const bySource: Record<string, { leadCount: number; contactedCount: number; bookedCount: number; soldCount: number }> = {};
  for (const s of stats) {
    const src = (s as any).source;
    if (!bySource[src]) bySource[src] = { leadCount: 0, contactedCount: 0, bookedCount: 0, soldCount: 0 };
    bySource[src].leadCount += (s as any).leadCount;
    bySource[src].contactedCount += (s as any).contactedCount;
    bySource[src].bookedCount += (s as any).bookedCount;
    bySource[src].soldCount += (s as any).soldCount;
  }

  return res.status(200).json({ bySource, raw: stats });
}

// pages/api/facebook/generate-report.ts
// POST — manually trigger daily action report generation for current user
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import AdActionReport from "@/models/AdActionReport";
import { generateDailyActionReport } from "@/lib/facebook/generateActionReport";
import { scoreAllCampaignsForUser } from "@/lib/facebook/scoreAdPerformance";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  await mongooseConnect();

  const userEmail = session.user.email.toLowerCase();
  const user = await User.findOne({ email: userEmail }).select("_id").lean();
  if (!user) return res.status(401).json({ message: "User not found" });

  // Check FB subscription
  const sub = await FBLeadSubscription.findOne({
    userEmail,
    status: { $in: ["active", "trialing"] },
  }).lean();
  if (!sub) return res.status(403).json({ message: "FB Ads Manager subscription required" });

  const userId = String(user._id);
  const today = new Date().toISOString().split("T")[0];

  try {
    // Check if report already generated today (use existing)
    const { force } = req.body || {};
    if (!force) {
      const existing = await AdActionReport.findOne({
        userId,
        type: "daily",
        date: today,
      })
        .sort({ generatedAt: -1 })
        .lean();

      if (existing) {
        return res.status(200).json({ ok: true, report: (existing as any).reportText, cached: true });
      }
    }

    // Score first, then generate
    await scoreAllCampaignsForUser(userId);
    const reportText = await generateDailyActionReport(userId, userEmail);

    return res.status(200).json({ ok: true, report: reportText, cached: false });
  } catch (err: any) {
    console.error("[generate-report]", err?.message);
    return res.status(500).json({ message: "Failed to generate report" });
  }
}

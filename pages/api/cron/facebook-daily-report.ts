// pages/api/cron/facebook-daily-report.ts
// Cron: generate daily FB action reports for all active FB subscribers
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import User from "@/models/User";
import { generateDailyActionReport } from "@/lib/facebook/generateActionReport";
import { scoreAllCampaignsForUser } from "@/lib/facebook/scoreAdPerformance";
import { applyAutoMode } from "@/lib/facebook/applyAutoMode";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  // Get all active FB subscribers
  const subs = await FBLeadSubscription.find({ status: "active" })
    .select("userEmail userId")
    .lean();

  let processed = 0;
  let errors = 0;

  for (const sub of subs) {
    const userEmail = (sub as any).userEmail;
    try {
      // 1. Get userId from User if not on sub
      let userId = String((sub as any).userId || "");
      if (!userId) {
        const user = await User.findOne({ email: userEmail }).select("_id").lean();
        if (!user) continue;
        userId = String(user._id);
      }

      // 2. Score all campaigns first
      await scoreAllCampaignsForUser(userId);

      // 3. Generate daily action report
      await generateDailyActionReport(userId, userEmail);

      // 4. Apply auto mode nudges
      await applyAutoMode(userId, userEmail);

      processed++;
    } catch (err: any) {
      console.error(`[facebook-daily-report] ${userEmail}:`, err?.message);
      errors++;
    }
  }

  return res.status(200).json({ ok: true, processed, errors });
}

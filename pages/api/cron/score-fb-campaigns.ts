// pages/api/cron/score-fb-campaigns.ts
// Cron: re-score all FB campaigns for all active subscribers
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import User from "@/models/User";
import { scoreAllCampaignsForUser } from "@/lib/facebook/scoreAdPerformance";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const subs = await FBLeadSubscription.find({ status: "active" })
    .select("userEmail userId")
    .lean();

  let processed = 0;
  let errors = 0;

  for (const sub of subs) {
    const userEmail = (sub as any).userEmail;
    try {
      let userId = String((sub as any).userId || "");
      if (!userId) {
        const user = await User.findOne({ email: userEmail }).select("_id").lean();
        if (!user) continue;
        userId = String(user._id);
      }

      await scoreAllCampaignsForUser(userId);
      processed++;
    } catch (err: any) {
      console.error(`[score-fb-campaigns] ${userEmail}:`, err?.message);
      errors++;
    }
  }

  return res.status(200).json({ ok: true, processed, errors });
}

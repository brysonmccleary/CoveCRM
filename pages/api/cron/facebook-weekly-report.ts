// pages/api/cron/facebook-weekly-report.ts
// Cron: generate weekly market intelligence report for all active FB subscribers
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";
import User from "@/models/User";
import { generateWeeklyMarketReport } from "@/lib/facebook/generateWeeklyMarketReport";

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

      await generateWeeklyMarketReport(userId, userEmail);
      processed++;
    } catch (err: any) {
      console.error(`[facebook-weekly-report] ${userEmail}:`, err?.message);
      errors++;
    }
  }

  return res.status(200).json({ ok: true, processed, errors });
}

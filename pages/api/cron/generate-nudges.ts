// pages/api/cron/generate-nudges.ts
// Cron: generates follow-up nudges for all active users
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { generateNudgesForUser } from "@/lib/leads/generateNudges";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const users = await User.find({ trialGranted: true }).select("email").lean();
  let total = 0;

  for (const user of users) {
    try {
      const count = await generateNudgesForUser(user.email);
      total += count;
    } catch (err: any) {
      console.warn("[generate-nudges] Error for", user.email, err?.message);
    }
  }

  return res.status(200).json({ ok: true, nudgesCreated: total });
}

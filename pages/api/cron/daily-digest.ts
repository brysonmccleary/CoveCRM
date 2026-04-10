// pages/api/cron/daily-digest.ts
// Cron: send daily performance digest emails to opted-in users
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { sendDailyDigest } from "@/lib/email/sendDailyDigest";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  // Only send to users with dailyDigest enabled
  const users = await User.find({
    "notifications.dailyDigest": true,
    trialGranted: true,
  })
    .select("email")
    .lean();

  let sent = 0;
  let failed = 0;

  for (const user of users) {
    try {
      await sendDailyDigest(user.email);
      sent++;
    } catch (err: any) {
      console.warn("[daily-digest] Failed for", user.email, err?.message);
      failed++;
    }
  }

  return res.status(200).json({ ok: true, sent, failed });
}

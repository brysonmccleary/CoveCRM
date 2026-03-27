// pages/api/cron/check-spam-status.ts
// Cron: checks spam status for all user phone numbers (weekly is fine)
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import NumberSpamStatus from "@/models/NumberSpamStatus";
import { checkSpamStatus } from "@/lib/twilio/checkSpamStatus";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const users = await User.find({ "numbers.0": { $exists: true } })
    .select("email numbers")
    .lean();

  let checked = 0;
  let flagged = 0;

  for (const user of users) {
    const numbers = (user as any).numbers || [];
    for (const num of numbers) {
      if (!num.phoneNumber) continue;
      try {
        const result = await checkSpamStatus(num.phoneNumber);
        await NumberSpamStatus.findOneAndUpdate(
          { phoneNumber: num.phoneNumber, userEmail: user.email },
          {
            $set: {
              spamScore: result.spamScore,
              spamLabel: result.spamLabel,
              isSpam: result.isSpam,
              checkedAt: new Date(),
              rawResponse: result.raw,
            },
          },
          { upsert: true }
        );
        checked++;
        if (result.isSpam) flagged++;
      } catch (err: any) {
        console.warn("[check-spam-status] Error for", num.phoneNumber, err?.message);
      }
    }
  }

  return res.status(200).json({ ok: true, checked, flagged });
}

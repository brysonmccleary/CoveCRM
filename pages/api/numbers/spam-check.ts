// pages/api/numbers/spam-check.ts
// POST — check spam status for a phone number
// GET  — get cached spam status for all user numbers
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import NumberSpamStatus from "@/models/NumberSpamStatus";
import { checkSpamStatus } from "@/lib/twilio/checkSpamStatus";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const statuses = await NumberSpamStatus.find({ userEmail }).lean();
    return res.status(200).json({ statuses });
  }

  if (req.method === "POST") {
    const { phoneNumber } = req.body as { phoneNumber?: string };
    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber required" });

    const result = await checkSpamStatus(phoneNumber);

    const status = await NumberSpamStatus.findOneAndUpdate(
      { phoneNumber, userEmail },
      {
        $set: {
          spamScore: result.spamScore,
          spamLabel: result.spamLabel,
          isSpam: result.isSpam,
          checkedAt: new Date(),
          rawResponse: result.raw,
        },
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({ ok: true, status });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

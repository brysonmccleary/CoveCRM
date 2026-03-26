// pages/api/email/suppress.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import EmailSuppression from "@/models/EmailSuppression";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();

  const { email, reason } = req.body || {};
  if (!email) return res.status(400).json({ error: "email is required" });

  await mongooseConnect();

  const user = await User.findOne({ email: userEmail }).select("_id").lean();
  if (!user?._id) return res.status(404).json({ error: "User not found" });

  const validReasons = ["unsubscribed", "bounced", "complaint", "manual"];
  const normalizedReason = validReasons.includes(reason) ? reason : "manual";

  await EmailSuppression.updateOne(
    { userEmail, email: email.toLowerCase().trim() },
    {
      $setOnInsert: {
        userId: user._id,
        userEmail,
        email: email.toLowerCase().trim(),
        reason: normalizedReason,
        suppressedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return res.status(200).json({ ok: true });
}

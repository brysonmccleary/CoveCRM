// pages/api/facebook/subscription-status.ts
// GET — returns user's FB Lead Manager subscription status
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const sub = await FBLeadSubscription.findOne({
    userEmail: session.user.email.toLowerCase(),
  }).lean();

  if (!sub) {
    return res.status(200).json({ subscribed: false });
  }

  return res.status(200).json({
    subscribed: true,
    plan: sub.plan,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
  });
}

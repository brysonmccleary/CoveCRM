// pages/api/facebook/reactivate.ts
// POST — reactivates a cancelled FB Lead Manager subscription (called by Stripe webhook on repurchase)
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const periodEnd = new Date();
  periodEnd.setDate(periodEnd.getDate() + 30);

  const sub = await FBLeadSubscription.findOneAndUpdate(
    { userEmail: session.user.email.toLowerCase() },
    { $set: { status: "active", currentPeriodEnd: periodEnd } },
    { new: true }
  );

  if (!sub) return res.status(404).json({ error: "No subscription found to reactivate" });

  return res.status(200).json({ ok: true });
}

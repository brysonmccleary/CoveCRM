// pages/api/admin/fb-subscriptions.ts
// GET — admin only; returns all FBLeadSubscription records
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadSubscription from "@/models/FBLeadSubscription";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  if (session.user.email.toLowerCase() !== ADMIN_EMAIL) return res.status(403).json({ error: "Forbidden" });

  await mongooseConnect();

  const subscriptions = await FBLeadSubscription.find({})
    .sort({ createdAt: -1 })
    .lean();

  return res.status(200).json({ subscriptions });
}

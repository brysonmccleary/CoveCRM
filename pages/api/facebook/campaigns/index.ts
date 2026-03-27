// pages/api/facebook/campaigns/index.ts
// GET — list all FB lead campaigns for user
// POST — create new FB lead campaign
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import User from "@/models/User";
import mongoose from "mongoose";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  if (req.method === "GET") {
    const filter: Record<string, any> = { userEmail: session.user.email.toLowerCase() };
    if (req.query.leadType) filter.leadType = req.query.leadType;

    const campaigns = await FBLeadCampaign.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ campaigns });
  }

  if (req.method === "POST") {
    const { leadType, campaignName, dailyBudget, plan, notes } = req.body as {
      leadType: string;
      campaignName: string;
      dailyBudget?: number;
      plan?: string;
      notes?: string;
    };

    if (!leadType || !campaignName) {
      return res.status(400).json({ error: "leadType and campaignName are required" });
    }

    const user = await User.findOne({ email: session.user.email }).select("_id").lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const campaign = await FBLeadCampaign.create({
      userId: (user as any)._id,
      userEmail: session.user.email.toLowerCase(),
      leadType,
      campaignName,
      dailyBudget: dailyBudget ?? 0,
      plan: plan ?? "manager",
      notes: notes ?? "",
      status: "setup",
    });

    return res.status(201).json({ ok: true, campaign });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

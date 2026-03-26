// pages/api/email/campaigns/index.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import EmailCampaign from "@/models/EmailCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();

  await mongooseConnect();

  if (req.method === "GET") {
    const campaigns = await EmailCampaign.find({ userEmail })
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json(campaigns);
  }

  if (req.method === "POST") {
    const { name, fromName, fromEmail, replyTo, dailyLimit, steps } =
      req.body || {};
    if (!name) return res.status(400).json({ error: "name is required" });

    const user = await User.findOne({ email: userEmail }).select("_id").lean();
    if (!user?._id) return res.status(404).json({ error: "User not found" });

    const campaign = await EmailCampaign.create({
      userId: user._id,
      userEmail,
      name,
      fromName: fromName || "",
      fromEmail: fromEmail || "",
      replyTo: replyTo || "",
      dailyLimit: dailyLimit ?? 100,
      steps: steps || [],
      isActive: true,
    });

    return res.status(201).json(campaign);
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

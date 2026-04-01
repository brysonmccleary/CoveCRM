// pages/api/recruiting/enroll-campaign.ts
// Bulk-enrolls all leads in a recruiting folder into an email campaign.
// POST { campaignId, folderId }

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import { Types } from "mongoose";
import Lead from "@/models/Lead";
import User from "@/models/User";
import EmailCampaign from "@/models/EmailCampaign";
import ProspectRecord from "@/models/ProspectRecord";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const { campaignId, folderId } = req.body || {};

  if (!campaignId || !Types.ObjectId.isValid(campaignId)) {
    return res.status(400).json({ error: "Invalid campaignId" });
  }
  if (!folderId || !Types.ObjectId.isValid(folderId)) {
    return res.status(400).json({ error: "Invalid folderId" });
  }

  // Verify campaign belongs to this user
  const campaign = await EmailCampaign.findOne({
    _id: new Types.ObjectId(campaignId),
    userEmail,
    isActive: true,
  }).lean() as any;
  if (!campaign) return res.status(404).json({ error: "Campaign not found or inactive" });

  // Get user for userId
  const user = await User.findOne({ email: userEmail }).select("_id").lean() as any;
  if (!user) return res.status(404).json({ error: "User not found" });

  // Get all leads in this folder that have an email address
  const leads = await Lead.find({
    userEmail,
    folderId: new Types.ObjectId(folderId),
    $or: [
      { Email: { $exists: true, $ne: "" } },
      { email: { $exists: true, $ne: "" } },
    ],
  }).select("_id Email email").lean() as any[];

  if (!leads.length) {
    return res.status(200).json({ enrolled: 0, skipped: 0, message: "No leads with email found in folder" });
  }

  const now = new Date();
  // Schedule first send for 9am next window
  const nextSend = new Date();
  nextSend.setDate(nextSend.getDate() + (nextSend.getHours() >= 9 ? 1 : 0));
  nextSend.setHours(9, 0, 0, 0);

  let enrolled = 0;
  let skipped = 0;

  for (const lead of leads) {
    const leadEmail = (lead.email || lead.Email || "").toLowerCase().trim();
    if (!leadEmail) { skipped++; continue; }

    try {
      // Check if already has an active/paused enrollment for this campaign
      const existing = await ProspectRecord.findOne({
        leadId: lead._id,
        campaignId: new Types.ObjectId(campaignId),
        status: { $in: ["active", "paused"] },
      }).select("_id").lean();

      if (existing) { skipped++; continue; }

      // Check if ever stopped/completed for this lead+campaign
      const blocked = await ProspectRecord.findOne({
        leadId: lead._id,
        campaignId: new Types.ObjectId(campaignId),
        $or: [
          { stopAll: true },
          { status: { $in: ["canceled", "completed"] } },
        ],
      }).select("_id").lean();

      if (blocked) { skipped++; continue; }

      await ProspectRecord.create({
        leadId: lead._id,
        userId: user._id,
        userEmail,
        campaignId: new Types.ObjectId(campaignId),
        leadEmail,
        status: "active",
        cursorStep: 0,
        nextSendAt: nextSend,
        startedAt: now,
        stopOnReply: true,
      });

      enrolled++;
    } catch (err: any) {
      if (err?.code === 11000) { skipped++; } // duplicate index — already enrolled
      else console.error("[enroll-campaign] error for lead", lead._id, err?.message);
    }
  }

  return res.status(200).json({
    enrolled,
    skipped,
    total: leads.length,
    message: `Enrolled ${enrolled} leads. Skipped ${skipped} (already enrolled or no email).`,
  });
}

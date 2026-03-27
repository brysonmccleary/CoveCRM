// pages/api/facebook/connect-sheet.ts
// POST — connect a Google Sheet / Apps Script URL to an FB lead campaign
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { campaignId, googleSheetUrl, appsScriptUrl } = req.body as {
    campaignId?: string;
    googleSheetUrl?: string;
    appsScriptUrl?: string;
  };

  if (!campaignId) return res.status(400).json({ error: "campaignId is required" });

  await mongooseConnect();

  const campaign = await FBLeadCampaign.findOne({
    _id: campaignId,
    userEmail: session.user.email.toLowerCase(),
  });

  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const updates: Record<string, any> = {};
  if (googleSheetUrl !== undefined) updates.googleSheetUrl = googleSheetUrl;
  if (appsScriptUrl !== undefined) updates.appsScriptUrl = appsScriptUrl;

  Object.assign(campaign, updates);
  await campaign.save();

  return res.status(200).json({ ok: true, campaign });
}

// pages/api/facebook/campaigns/index.ts
// GET — list all FB lead campaigns for user
// POST — create new FB lead campaign
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import MetaLaunchArchive from "@/models/MetaLaunchArchive";
import User from "@/models/User";
import mongoose from "mongoose";
import { normalizeStateCodes } from "@/lib/facebook/geo/usStates";
import { getCanonicalHeaders, getLeadSheetType } from "@/lib/facebook/sheets/sheetHeaders";
import { resolveAudienceSegment } from "@/lib/facebook/audienceTargeting";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  if (req.method === "GET") {
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const filter: Record<string, any> = { userEmail: session.user.email.toLowerCase() };
    if (req.query.leadType) filter.leadType = req.query.leadType;

    const campaigns = await FBLeadCampaign.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    // The immutable launch archive contains the exact flattened image uploaded
    // to Meta. Only return a protected URL here so the campaign list stays
    // lightweight even when an account has hundreds of campaigns.
    const campaignIds = campaigns.map((campaign: any) => campaign._id);
    const archivedCampaigns = campaignIds.length
      ? await MetaLaunchArchive.aggregate([
          {
            $match: {
              userEmail: session.user.email.toLowerCase(),
              campaignId: { $in: campaignIds },
            },
          },
          {
            $project: {
              campaignId: 1,
              imageCount: { $size: { $ifNull: ["$images", []] } },
            },
          },
        ])
      : [];
    const archiveImageCounts = new Map(
      archivedCampaigns.map((archive: any) => [String(archive.campaignId), Number(archive.imageCount || 0)])
    );
    const campaignRows = campaigns.map((campaign: any) => ({
      ...campaign,
      reconciliationUrl: `/api/facebook/campaigns/${campaign._id}/reconciliation`,
      ...(archiveImageCounts.has(String(campaign._id))
        ? {
            creativePreviewUrl: `/api/facebook/campaigns/${campaign._id}/creative-preview`,
            creativePreviewUrls: Array.from(
              { length: Math.min(4, archiveImageCounts.get(String(campaign._id)) || 0) },
              (_, index) => `/api/facebook/campaigns/${campaign._id}/creative-preview?variant=${index}`
            ),
          }
        : {}),
    }));

    return res.status(200).json({ campaigns: campaignRows });
  }

  if (req.method === "POST") {
    const {
      leadType,
      campaignName,
      dailyBudget,
      plan,
      notes,
      licensedStates,
      stateRestrictionNoticeAccepted,
    } = req.body as {
      leadType: string;
      campaignName: string;
      dailyBudget?: number;
      plan?: string;
      notes?: string;
      licensedStates?: string[];
      stateRestrictionNoticeAccepted?: boolean;
    };

    if (!leadType || !campaignName) {
      return res.status(400).json({ error: "leadType and campaignName are required" });
    }

    const user = await User.findOne({ email: session.user.email })
      .select("_id metaPageId metaPageName metaAdAccountId")
      .lean() as any;
    if (!user) return res.status(404).json({ error: "User not found" });
    const normalizedStates = normalizeStateCodes(licensedStates);
    if (!normalizedStates.length) {
      return res.status(400).json({ error: "Select at least one licensed state before creating a campaign." });
    }
    if (!stateRestrictionNoticeAccepted) {
      return res.status(400).json({ error: "State restriction notice must be acknowledged before creating a campaign." });
    }
    const sheetType = getLeadSheetType(leadType);
    let audienceSegment = "standard";
    try {
      audienceSegment = resolveAudienceSegment({ leadType, audienceSegment: req.body?.audienceSegment });
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Invalid audience segment" });
    }
    const funnelSlug = String(campaignName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);

    const campaign = await FBLeadCampaign.create({
      userId: (user as any)._id,
      userEmail: session.user.email.toLowerCase(),
      leadType,
      audienceSegment,
      campaignName,
      dailyBudget: dailyBudget ?? 0,
      plan: plan ?? "manager",
      notes: notes ?? "",
      webhookKey: Math.random().toString(36).substring(2, 12),
      funnelSlug,
      funnelStatus: "active",
      funnelVersion: "2026-04-production-v1",
      facebookPageId: String(user.metaPageId || "").trim(),
      facebookPageName: String(user.metaPageName || "").trim(),
      adAccountId: String(user.metaAdAccountId || "").trim().replace(/^act_/, ""),
      licensedStates: normalizedStates,
      borderStateBehavior: "allow_with_warning",
      stateRestrictionNoticeAccepted: true,
      leadSheetType: sheetType,
      expectedSheetHeaders: getCanonicalHeaders(sheetType),
      writeLeadsToSheet: true,
      status: "setup",
    });

    return res.status(201).json({ ok: true, campaign });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

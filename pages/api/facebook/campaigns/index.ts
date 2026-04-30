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
import { normalizeStateCodes } from "@/lib/facebook/geo/usStates";
import { getCanonicalHeaders, getLeadSheetType } from "@/lib/facebook/sheets/sheetHeaders";

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
    const {
      leadType,
      campaignName,
      dailyBudget,
      plan,
      notes,
      licensedStates,
      borderStateBehavior,
      stateRestrictionNoticeAccepted,
    } = req.body as {
      leadType: string;
      campaignName: string;
      dailyBudget?: number;
      plan?: string;
      notes?: string;
      licensedStates?: string[];
      borderStateBehavior?: "allow_with_warning" | "block";
      stateRestrictionNoticeAccepted?: boolean;
    };

    if (!leadType || !campaignName) {
      return res.status(400).json({ error: "leadType and campaignName are required" });
    }

    const user = await User.findOne({ email: session.user.email })
      .select("_id metaLeadTypeAssets metaPageId metaPageName metaAdAccountId")
      .lean() as any;
    if (!user) return res.status(404).json({ error: "User not found" });
    const leadTypeAssets =
      leadType && user?.metaLeadTypeAssets
        ? user.metaLeadTypeAssets instanceof Map
          ? user.metaLeadTypeAssets.get(leadType)
          : user.metaLeadTypeAssets[leadType]
        : null;
    const normalizedStates = normalizeStateCodes(licensedStates);
    if (!normalizedStates.length) {
      return res.status(400).json({ error: "Select at least one licensed state before creating a campaign." });
    }
    if (!stateRestrictionNoticeAccepted) {
      return res.status(400).json({ error: "State restriction notice must be acknowledged before creating a campaign." });
    }
    const sheetType = getLeadSheetType(leadType);
    const funnelSlug = String(campaignName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);

    const campaign = await FBLeadCampaign.create({
      userId: (user as any)._id,
      userEmail: session.user.email.toLowerCase(),
      leadType,
      campaignName,
      dailyBudget: dailyBudget ?? 0,
      plan: plan ?? "manager",
      notes: notes ?? "",
      webhookKey: Math.random().toString(36).substring(2, 12),
      funnelSlug,
      funnelStatus: "active",
      funnelVersion: "2026-04-production-v1",
      facebookPageId: String(leadTypeAssets?.pageId || user.metaPageId || "").trim(),
      facebookPageName: String(leadTypeAssets?.pageName || user.metaPageName || "").trim(),
      adAccountId: String(leadTypeAssets?.adAccountId || user.metaAdAccountId || "").trim().replace(/^act_/, ""),
      licensedStates: normalizedStates,
      borderStateBehavior: borderStateBehavior === "allow_with_warning" ? "allow_with_warning" : "block",
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

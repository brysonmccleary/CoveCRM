import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { validateCampaignInput } from "@/lib/recruiting/social/policy";
import { RECRUITING_PUBLIC_MESSAGES } from "@/lib/recruiting/public-errors";
import type { SocialCampaignInput } from "@/lib/recruiting/social/types";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  if (req.method === "GET") {
    try {
      await mongooseConnect();
      const campaigns = await RecruitingCampaign.find({ ownerEmail: admin.email })
        .sort({ createdAt: -1 })
        .limit(100)
        .lean();
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json({ campaigns, liveExecutionEnabled: true });
    } catch {
      return res.status(503).json({ code: "CAMPAIGN_LOAD_FAILED", error: RECRUITING_PUBLIC_MESSAGES.CAMPAIGN_LOAD_FAILED });
    }
  }

  if (req.method === "POST") {
    try {
      await mongooseConnect();
      const input = validateCampaignInput(req.body as SocialCampaignInput);
      const campaign = await RecruitingCampaign.create({
        ownerEmail: admin.email,
        ...input,
        status: "simulation_ready",
        executionMode: "simulation",
        liveExecutionEnabled: false,
      });
      await RecruitingAuditEvent.create({
        ownerEmail: admin.email,
        actorEmail: admin.email,
        eventType: "campaign_created",
        entityType: "campaign",
        entityId: String(campaign._id),
        details: { platforms: input.platforms, actions: input.actions, executionMode: "simulation" },
      });
      return res.status(201).json({ campaign });
    } catch {
      return res.status(400).json({ code: "CAMPAIGN_INPUT_INVALID", error: RECRUITING_PUBLIC_MESSAGES.CAMPAIGN_INPUT_INVALID });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

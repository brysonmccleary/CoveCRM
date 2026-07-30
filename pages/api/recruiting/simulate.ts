import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import { socialAdapters } from "@/lib/recruiting/social/adapters";
import { createSimulationDraft } from "@/lib/recruiting/social/policy";
import { RecruitingPublicError, recruitingErrorPayload } from "@/lib/recruiting/public-errors";
import type { SocialActionType, SocialTargetSnapshot } from "@/lib/recruiting/social/types";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingProspect from "@/models/RecruitingProspect";
import RecruitingSocialAction from "@/models/RecruitingSocialAction";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;

  const campaignId = String(req.body?.campaignId || "");
  if (!Types.ObjectId.isValid(campaignId)) return res.status(400).json({ code: "SIMULATION_FAILED", error: "Choose a valid campaign first." });

  try {
    await mongooseConnect();
    const campaign = await RecruitingCampaign.findOne({
      _id: new Types.ObjectId(campaignId),
      ownerEmail: admin.email,
      // "active" is included so a launched campaign can be spot-tested without
      // pausing it — the simulation adapter never makes a provider request.
      status: { $in: ["draft", "simulation_ready", "paused", "active"] },
    }).lean() as any;
    if (!campaign) throw new RecruitingPublicError("SIMULATION_FAILED", "That campaign is no longer available.");
    const target = req.body?.target as SocialTargetSnapshot;
    const actionType = String(req.body?.actionType || "") as SocialActionType;
    if (!campaign.platforms?.includes(target?.platform)) throw new RecruitingPublicError("SIMULATION_FAILED", "Choose a platform enabled for this campaign.");
    if (!campaign.actions?.includes(actionType)) throw new RecruitingPublicError("SIMULATION_FAILED", "Choose an action enabled for this campaign.");

    const draft = createSimulationDraft({
      campaignId,
      actionType,
      target,
      message: actionType === "dm" ? String(req.body?.message || campaign.openingMessage || "") : undefined,
    });
    const result = await socialAdapters[draft.platform].simulate(draft);

    const prospect = await RecruitingProspect.findOneAndUpdate(
      { ownerEmail: admin.email, platform: draft.platform, externalRecipientId: draft.target.externalRecipientId },
      {
        $setOnInsert: {
          ownerEmail: admin.email,
          platform: draft.platform,
          externalRecipientId: draft.target.externalRecipientId,
          recipientLock: draft.recipientLock,
          snapshotCapturedAt: new Date(draft.target.capturedAt),
        },
        $set: {
          campaignId: campaign._id,
          profileUrl: draft.target.profileUrl,
          displayName: draft.target.displayName,
          headline: draft.target.headline || "",
          recipientLock: draft.recipientLock,
          snapshotCapturedAt: new Date(draft.target.capturedAt),
          status: "reviewed",
        },
      },
      { upsert: true, new: true },
    );

    const action = await RecruitingSocialAction.findOneAndUpdate(
      { ownerEmail: admin.email, idempotencyKey: draft.idempotencyKey },
      {
        $setOnInsert: {
          ownerEmail: admin.email,
          campaignId: campaign._id,
          prospectId: prospect._id,
          platform: draft.platform,
          actionType: draft.actionType,
          executionMode: "simulation",
          targetSnapshot: draft.target,
          recipientLock: draft.recipientLock,
          message: draft.message || "",
          idempotencyKey: draft.idempotencyKey,
          status: "simulated",
          providerRequestMade: false,
          validationSummary: result.summary,
        },
      },
      { upsert: true, new: true },
    );

    await RecruitingAuditEvent.updateOne(
      { ownerEmail: admin.email, eventType: "action_simulated", entityId: String(action._id) },
      {
        $setOnInsert: {
          ownerEmail: admin.email,
          actorEmail: admin.email,
          eventType: "action_simulated",
          entityType: "social_action",
          entityId: String(action._id),
          details: {
            campaignId,
            platform: draft.platform,
            actionType: draft.actionType,
            recipientLock: draft.recipientLock,
            providerRequestMade: false,
          },
          occurredAt: new Date(),
        },
      },
      { upsert: true },
    );

    return res.status(200).json({ action, result, liveExecutionEnabled: false });
  } catch (error) {
    const status = error instanceof RecruitingPublicError ? 400 : 503;
    return res.status(status).json(recruitingErrorPayload(error, "SIMULATION_FAILED"));
  }
}

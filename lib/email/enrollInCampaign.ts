// lib/email/enrollInCampaign.ts
import mongooseConnect from "@/lib/mongooseConnect";
import EmailCampaign from "@/models/EmailCampaign";
import ProspectRecord from "@/models/ProspectRecord";
import mongoose from "mongoose";

export interface EnrollInCampaignOptions {
  leadId: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  userEmail: string;
  campaignId: string | mongoose.Types.ObjectId;
  /** The recipient email address for this lead */
  leadEmail: string;
  /** Optional scheduled start; defaults to now */
  startAt?: Date;
}

export interface EnrollResult {
  ok: boolean;
  enrollmentId?: string;
  wasNew?: boolean;
  error?: string;
}

export async function enrollInEmailCampaign(
  opts: EnrollInCampaignOptions
): Promise<EnrollResult> {
  await mongooseConnect();

  const { leadId, userId, userEmail, campaignId, leadEmail, startAt } = opts;

  const campaign = await EmailCampaign.findOne({ _id: campaignId, isActive: true })
    .select("_id steps dailyLimit")
    .lean();

  if (!campaign) return { ok: false, error: "Campaign not found or inactive" };
  if (!Array.isArray(campaign.steps) || campaign.steps.length === 0) {
    return { ok: false, error: "Campaign has no steps" };
  }

  const nextSendAt = startAt || new Date();

  try {
    const result = await ProspectRecord.updateOne(
      { leadId, campaignId, status: { $in: ["active", "paused"] } },
      {
        $setOnInsert: {
          leadId,
          userId,
          userEmail: userEmail.toLowerCase().trim(),
          campaignId,
          leadEmail: leadEmail.toLowerCase().trim(),
          status: "active",
          cursorStep: 0,
          nextSendAt,
          startedAt: new Date(),
          stopOnReply: true,
          paused: false,
          stopAll: false,
          processing: false,
        },
      },
      { upsert: true }
    );

    const wasNew = Boolean(
      (result as any).upsertedCount || (result as any).upsertedId
    );
    const record = await ProspectRecord.findOne({ leadId, campaignId }).lean();

    return { ok: true, enrollmentId: String(record?._id), wasNew };
  } catch (err: any) {
    if (err?.code === 11000) {
      return { ok: true, wasNew: false, error: "Already enrolled" };
    }
    return { ok: false, error: err?.message || "Enrollment failed" };
  }
}

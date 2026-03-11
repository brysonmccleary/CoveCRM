import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import DripEnrollment from "@/models/DripEnrollment";
import DripCampaign from "@/models/DripCampaign";

type Body = {
  leadId?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const email = String(session.user.email).toLowerCase();
    const { leadId }: Body = req.body || {};

    if (!leadId) {
      return res.status(400).json({ error: "leadId is required" });
    }

    await dbConnect();

    const lead = await Lead.findOne({
      _id: leadId,
      $or: [{ userEmail: email }, { ownerEmail: email }],
    });

    if (lead && !(lead as any).userEmail) {
      try {
        await Lead.updateOne({ _id: (lead as any)._id }, { $set: { userEmail: email } });
      } catch {}
    }

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // Prefer most recent paused/canceled enrollment so we continue where it left off.
    const enrollment: any = await DripEnrollment.findOne({
      userEmail: email,
      leadId,
      status: { $in: ["paused", "canceled", "cancelled"] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    if (!enrollment?._id) {
      return res.status(404).json({ error: "No paused or canceled drip found for this lead" });
    }

    const campaign: any = await DripCampaign.findOne({ _id: enrollment.campaignId })
      .select("_id name key isActive type")
      .lean();

    if (!campaign?._id) {
      return res.status(404).json({ error: "Campaign not found for previous drip enrollment" });
    }

    if (campaign.isActive !== true || campaign.type !== "sms") {
      return res.status(400).json({ error: "Previous drip campaign is not active" });
    }

    const now = new Date();

    await DripEnrollment.updateOne(
      { _id: enrollment._id, userEmail: email },
      {
        $set: {
          status: "active",
          nextSendAt: now,
          isActive: true,
          isPaused: false,
          stopAll: false,
          active: true,
          enabled: true,
          lastError: null,
          resumedAt: now,
        },
        $unset: {
          processing: 1,
          processingAt: 1,
        },
      }
    );

    // Restore legacy lead markers so UI / older code paths stay aligned.
    try {
      const existingAssigned = Array.isArray((lead as any).assignedDrips) ? (lead as any).assignedDrips : [];
      const existingProgress = Array.isArray((lead as any).dripProgress) ? (lead as any).dripProgress : [];

      const campaignIdStr = String(campaign._id);
      const cursorStep =
        typeof enrollment.cursorStep === "number" && Number.isFinite(enrollment.cursorStep)
          ? enrollment.cursorStep
          : 0;

      const assignedSet = new Set(existingAssigned.map((v: any) => String(v)));
      assignedSet.add(campaignIdStr);

      const nextProgress = existingProgress.filter(
        (p: any) => String(p?.dripId || "") !== campaignIdStr
      );

      nextProgress.push({
        dripId: campaignIdStr,
        startedAt: enrollment.startedAt || enrollment.createdAt || now,
        lastSentIndex: Math.max(0, cursorStep - 1),
      });

      (lead as any).assignedDrips = Array.from(assignedSet);
      (lead as any).dripProgress = nextProgress;
      (lead as any).isAIEngaged = false;

      await lead.save();
    } catch (e) {
      console.warn("[drips/resume-lead] lead marker restore warning:", e);
    }

    return res.status(200).json({
      success: true,
      enrollmentId: String(enrollment._id),
      campaignId: String(campaign._id),
      campaignName: String(campaign.name || "Drip Campaign"),
      cursorStep:
        typeof enrollment.cursorStep === "number" && Number.isFinite(enrollment.cursorStep)
          ? enrollment.cursorStep
          : 0,
      nextSendAt: now.toISOString(),
      message: "Drip resumed",
    });
  } catch (err: any) {
    console.error("[drips/resume-lead] error:", err);
    return res.status(500).json({ error: "Server error", detail: err?.message || "Unknown error" });
  }
}

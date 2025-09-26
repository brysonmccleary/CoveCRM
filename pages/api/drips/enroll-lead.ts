// pages/api/drips/enroll-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";
import DripEnrollment from "@/models/DripEnrollment";
import Lead from "@/models/Lead";

type Body = {
  leadId?: string;
  campaignId?: string;
  startAt?: string; // ISO datetime optional
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { leadId, campaignId, startAt }: Body = (req.body || {}) as any;
    if (!leadId || !campaignId) {
      return res.status(400).json({ error: "leadId and campaignId are required" });
    }

    await dbConnect();

    // Validate lead ownership/scope (adjust this if your Lead schema scopes differently)
    const lead = await Lead.findOne({ _id: leadId, userEmail: session.user.email }).select("_id").lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    // Validate campaign (isActive)
    const campaign = (await DripCampaign.findOne({ _id: campaignId })
      .select("_id name key isActive steps")
      .lean()) as any; // <-- cast to any to satisfy TS
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    if ((campaign as any).isActive !== true) {               // <-- guard via any
      return res.status(400).json({ error: "Campaign is not active" });
    }

    // Compute initial nextSendAt
    let nextSendAt: Date | undefined;
    if (startAt) {
      const parsed = new Date(startAt);
      if (!isNaN(parsed.getTime())) nextSendAt = parsed;
    }
    if (!nextSendAt) nextSendAt = new Date();

    // Create or dedupe active enrollment
    const enrollment = await DripEnrollment.findOneAndUpdate(
      {
        leadId,
        campaignId,
        status: { $in: ["active", "paused"] },
        userEmail: session.user.email,
      },
      {
        $setOnInsert: {
          leadId,
          campaignId,
          userEmail: session.user.email,
          status: "active",
          cursorStep: 0,
          nextSendAt,
          source: "manual-lead",
        },
      },
      { new: true, upsert: true }
    ).lean();

    const historyEntry = {
      type: "status",
      subType: "drip-enrolled",
      message: `Enrolled to ${campaign.name}`,
      campaignKey: campaign.key,
      at: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      enrollmentId: (enrollment as any)?._id,
      campaign: { id: String(campaign._id), name: campaign.name, key: campaign.key },
      nextSendAt,
      historyEntry,
    });
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(200).json({ success: true, deduped: true });
    }
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}

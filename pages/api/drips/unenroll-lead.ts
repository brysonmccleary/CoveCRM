// pages/api/drips/unenroll-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";
import Lead from "@/models/Lead";

type Body = {
  leadId?: string;
  campaignId?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const email = String(session.user.email).toLowerCase();

    const { leadId, campaignId }: Body = req.body || {};
    if (!leadId || !campaignId) {
      return res.status(400).json({ error: "leadId and campaignId are required" });
    }

    await dbConnect();

    // 1. Ensure this lead belongs to the user (tenant safety)
    const lead = await Lead.findOne({
      _id: leadId,
      userEmail: email,
    });

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // 2. Kill any active/paused DripEnrollment for this lead+campaign
    const upd = await DripEnrollment.updateMany(
      {
        userEmail: email,
        leadId,
        campaignId,
        status: { $in: ["active", "paused"] },
      },
      {
        $set: {
          status: "canceled",
          nextSendAt: null,
          isActive: false,
          isPaused: true,
          stopAll: true,
        },
        $unset: {
          processing: 1,
          processingAt: 1,
        },
      }
    );

    // 3. Remove drip assignment from Lead (legacy fields)
    (lead as any).assignedDrips = [];
    (lead as any).dripProgress = [];
    (lead as any).isAIEngaged = false;
    await lead.save();

    return res.status(200).json({
      success: true,
      matched: upd.matchedCount,
      modified: upd.modifiedCount,
      message: "Lead fully unenrolled from drip",
    });
  } catch (err: any) {
    console.error("unenroll-lead error:", err);
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}

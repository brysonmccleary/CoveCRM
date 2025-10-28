// pages/api/drips/unenroll-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";

type Body = {
  leadId?: string;
  campaignId?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { leadId, campaignId }: Body = (req.body || {}) as any;
    if (!leadId || !campaignId) {
      return res.status(400).json({ error: "leadId and campaignId are required" });
    }

    await dbConnect();

    const upd = await DripEnrollment.updateOne(
      {
        userEmail: session.user.email,
        leadId,
        campaignId,
        status: { $in: ["active", "paused"] },
      },
      {
        $set: {
          status: "canceled",
          paused: true,
          isPaused: true,
          stopAll: true,
          active: false,
          isActive: false,
          enabled: false,
          lastError: "manually removed",
        },
        $unset: {
          nextSendAt: 1,
          processing: 1,
          processingAt: 1,
        },
      }
    );

    return res.status(200).json({
      success: true,
      matched: upd.matchedCount,
      modified: upd.modifiedCount,
      message: upd.modifiedCount > 0 ? "Enrollment canceled" : "No active enrollment found",
    });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}

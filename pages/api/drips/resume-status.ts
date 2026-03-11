import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import DripEnrollment from "@/models/DripEnrollment";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const email = String(session.user.email).toLowerCase();
    const leadId = String(req.query.leadId || "").trim();

    if (!leadId) {
      return res.status(400).json({ error: "leadId is required" });
    }

    await dbConnect();

    const lead = await Lead.findOne({
      _id: leadId,
      $or: [{ userEmail: email }, { ownerEmail: email }],
    })
      .select("_id userEmail")
      .lean();

    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const active = await DripEnrollment.findOne({
      userEmail: email,
      leadId,
      status: { $in: ["active", "paused"] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select({ _id: 1, status: 1, campaignId: 1, cursorStep: 1 })
      .lean();

    const resumable = await DripEnrollment.findOne({
      userEmail: email,
      leadId,
      status: { $in: ["canceled", "cancelled"] },
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .select({ _id: 1, status: 1, campaignId: 1, cursorStep: 1 })
      .lean();

    return res.status(200).json({
      hasActive: !!active,
      hasResumable: !active && !!resumable,
      activeStatus: active?.status || null,
      activeEnrollmentId: active?._id ? String(active._id) : null,
      resumableEnrollmentId: resumable?._id ? String(resumable._id) : null,
    });
  } catch (err: any) {
    console.error("[drips/resume-status] error:", err);
    return res.status(500).json({ error: "Server error", detail: err?.message || "Unknown error" });
  }
}

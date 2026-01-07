// pages/api/drips/enrollments.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import DripEnrollment from "@/models/DripEnrollment";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const session = (await getServerSession(req, res, authOptions as any)) as any;
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const email = String(session.user.email).toLowerCase();

    const leadId = String(req.query.leadId || "").trim();
    if (!leadId) return res.status(400).json({ error: "leadId is required" });

    await dbConnect();

    // ✅ Tenant safety: confirm lead belongs to the user
    const lead = await Lead.findOne({ _id: leadId, userEmail: email }).select("_id").lean();
    if (!lead) return res.status(404).json({ error: "Lead not found" });

    const enrollments = await DripEnrollment.find({
      userEmail: email,
      leadId: leadId,
      status: { $in: ["active", "paused"] },
    })
      .select({
        _id: 1,
        leadId: 1,
        campaignId: 1,
        userEmail: 1,
        status: 1,
        cursorStep: 1,
        nextSendAt: 1,
        lastSentAt: 1,
        startedAt: 1,
        source: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      enrollments: (enrollments || []).map((e: any) => ({
        _id: String(e._id),
        leadId: String(e.leadId),
        campaignId: String(e.campaignId),
        status: e.status,
        cursorStep: typeof e.cursorStep === "number" ? e.cursorStep : 0,
        nextSendAt: e.nextSendAt ? new Date(e.nextSendAt).toISOString() : null,
        lastSentAt: e.lastSentAt ? new Date(e.lastSentAt).toISOString() : null,
        startedAt: e.startedAt ? new Date(e.startedAt).toISOString() : null,
        source: e.source || null,
        createdAt: e.createdAt ? new Date(e.createdAt).toISOString() : null,
        updatedAt: e.updatedAt ? new Date(e.updatedAt).toISOString() : null,
      })),
    });
  } catch (err: any) {
    console.error("[drips/enrollments] error", err);
    return res.status(500).json({ error: "Server error", detail: err?.message || "Unknown error" });
  }
}

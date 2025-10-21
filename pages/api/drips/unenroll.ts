import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DripEnrollment from "@/models/DripEnrollment";
import Lead from "@/models/Lead";
import { emitToUser } from "@/lib/socket";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions as any);
  const userEmail = String(session?.user?.email || "").toLowerCase();
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const { leadId, dripId, all } = (req.body || {}) as {
    leadId?: string;
    dripId?: string;
    all?: boolean;
  };

  if (!leadId) return res.status(400).json({ error: "Missing leadId" });
  if (!all && !dripId) return res.status(400).json({ error: "Missing dripId (or set all=true)" });

  await mongooseConnect();

  // Verify lead is tenant-owned
  const lead = await Lead.findById(leadId).lean<any>();
  if (!lead || String((lead.userEmail || lead.ownerEmail || "")).toLowerCase() !== userEmail) {
    return res.status(404).json({ error: "Lead not found" });
  }

  // Select enrollments to cancel
  const match: any = { userEmail, leadId, status: { $in: ["active", "paused"] } };
  if (!all && dripId) match.campaignId = dripId;

  const toCancel = await DripEnrollment.find(match).lean<any>();
  if (!toCancel.length) return res.status(200).json({ success: true, changed: 0 });

  const campIds = Array.from(new Set(toCancel.map((e: any) => String(e.campaignId))));

  // Cancel enrollments + stop scheduling
  await DripEnrollment.updateMany(
    { _id: { $in: toCancel.map((e: any) => e._id) } },
    {
      $set: {
        status: "canceled",
        active: false,
        isActive: false,
        enabled: false,
        paused: true,
        isPaused: true,
        stopAll: true,
        nextSendAt: null,
        processing: false,
        processingAt: null,
        lastError: undefined,
        updatedAt: new Date(),
      },
    }
  );

  // Pull from Lead.assignedDrips (if present)
  try {
    await Lead.updateOne(
      { _id: leadId, userEmail },
      { $pull: { assignedDrips: { $in: campIds } } }
    ).exec();
  } catch {}

  // Add a status note to interactionHistory
  const label = all ? "all drips" : (campIds.length === 1 ? `drip ${campIds[0]}` : `drips ${campIds.join(", ")}`);
  await Lead.updateOne(
    { _id: leadId, userEmail },
    {
      $push: {
        interactionHistory: {
          type: "status",
          text: `[status] Removed from ${label} by ${userEmail}`,
          date: new Date(),
        } as any,
      },
      $set: { updatedAt: new Date() },
    }
  ).exec();

  // Socket echo for UI refresh
  try { emitToUser(userEmail, "lead:updated", { leadId }); } catch {}

  res.status(200).json({ success: true, changed: toCancel.length, removedCampaignIds: campIds });
}

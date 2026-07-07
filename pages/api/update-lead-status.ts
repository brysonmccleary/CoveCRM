import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import LeadModel from "@/models/Lead"; // ✅ Make sure this exists
import mongoose from "mongoose";
import { buildSoldAtTransitionSet } from "@/lib/leads/foundationFields";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { leadId, status } = req.body;
  const userEmail = session.user.email.toLowerCase();

  if (!leadId || !status) {
    return res.status(400).json({ message: "Missing 'leadId' or 'status'" });
  }

  try {
    await dbConnect();

    const leadObjectId = new mongoose.Types.ObjectId(leadId);
    const tenantFilter = {
      _id: leadObjectId,
      $or: [{ userEmail }, { ownerEmail: userEmail }, { user: userEmail }],
    };

    const existing = await LeadModel.findOne(tenantFilter)
      .select({ _id: 1, status: 1, soldAt: 1 })
      .lean<{ _id: any; status?: string; soldAt?: Date | null } | null>();

    if (!existing) {
      return res
        .status(404)
        .json({ message: "Lead not found or access denied" });
    }

    const now = new Date();
    const setFields = {
      status,
      updatedAt: now,
      ...buildSoldAtTransitionSet({
        nextStatus: status,
        previousStatus: existing.status,
        existingSoldAt: existing.soldAt,
        now,
      }),
    };

    const result = await LeadModel.updateOne(
      tenantFilter,
      { $set: setFields },
    );

    if (result.matchedCount === 0) {
      return res
        .status(404)
        .json({ message: "Lead not found or access denied" });
    }

    return res
      .status(200)
      .json({ message: "Lead status updated successfully" });
  } catch (error: any) {
    console.error("Error updating lead status:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
}

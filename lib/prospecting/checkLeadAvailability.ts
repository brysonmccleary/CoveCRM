// lib/prospecting/checkLeadAvailability.ts
import mongooseConnect from "@/lib/mongooseConnect";
import DOILead from "@/models/DOILead";
import LeadAssignment from "@/models/LeadAssignment";
import mongoose from "mongoose";

export interface AvailabilityResult {
  available: number;
  byState: Record<string, number>;
}

/**
 * Returns how many DOI leads are currently available to assign to this user.
 * Available = not globally unsubscribed + cooldown expired/absent + never assigned to this user.
 */
export async function checkAvailability(
  userId: string | mongoose.Types.ObjectId,
  count: number
): Promise<AvailabilityResult> {
  await mongooseConnect();

  const now = new Date();

  // Leads already assigned to this user (ever)
  const assigned = await LeadAssignment.find({ userId })
    .select("doiLeadId")
    .lean();
  const excludeIds = assigned.map((a: any) => a.doiLeadId);

  const matchStage = {
    globallyUnsubscribed: false,
    $or: [
      { cooldownUntil: null },
      { cooldownUntil: { $exists: false } },
      { cooldownUntil: { $lte: now } },
    ],
    ...(excludeIds.length ? { _id: { $nin: excludeIds } } : {}),
  };

  const byState = await DOILead.aggregate([
    { $match: matchStage },
    { $group: { _id: "$state", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  const stateMap: Record<string, number> = {};
  let total = 0;
  for (const row of byState) {
    const key = row._id || "Unknown";
    stateMap[key] = row.count;
    total += row.count;
  }

  return { available: total, byState: stateMap };
}

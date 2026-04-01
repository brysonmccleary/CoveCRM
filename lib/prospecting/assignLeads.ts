// lib/prospecting/assignLeads.ts
import mongooseConnect from "@/lib/mongooseConnect";
import DOILead from "@/models/DOILead";
import LeadAssignment from "@/models/LeadAssignment";
import ProspectingPlan from "@/models/ProspectingPlan";
import Lead from "@/models/Lead";
import { enrollInEmailCampaign } from "@/lib/email/enrollInCampaign";
import mongoose from "mongoose";

export interface AssignLeadsResult {
  assigned: number;
  leads: any[];
  errors: string[];
}

/**
 * Core assignment engine.
 * Queries available DOI leads, creates CRM Lead + LeadAssignment records,
 * updates the DOILead cooldown, enrolls each lead in the email campaign,
 * and debits the ProspectingPlan.
 */
export async function assignLeadsToUser(
  userId: string | mongoose.Types.ObjectId,
  userEmail: string,
  count: number,
  planId: string | mongoose.Types.ObjectId,
  folderId?: string | mongoose.Types.ObjectId | null,
  campaignId?: string | mongoose.Types.ObjectId | null
): Promise<AssignLeadsResult> {
  await mongooseConnect();

  const now = new Date();

  // IDs of leads already assigned to this user (ever) — enforce at query level
  const existingAssignments = await LeadAssignment.find({ userId })
    .select("doiLeadId")
    .lean();
  const alreadyAssignedIds = existingAssignments.map((a: any) => a.doiLeadId);

  const baseMatch: Record<string, any> = {
    globallyUnsubscribed: false,
    email: { $not: /^_doi_.*@noemail\.doilead\.local$/ },
    $or: [
      { cooldownUntil: null },
      { cooldownUntil: { $exists: false } },
      { cooldownUntil: { $lte: now } },
    ],
    ...(alreadyAssignedIds.length
      ? { _id: { $nin: alreadyAssignedIds } }
      : {}),
  };

  // Get state distribution so no single state dominates the batch
  const stateCounts: { _id: string; count: number }[] = await DOILead.aggregate([
    { $match: baseMatch },
    { $group: { _id: "$state", count: { $sum: 1 } } },
  ]);

  const totalAvailable = stateCounts.reduce((s, r) => s + r.count, 0);
  const toAssign = Math.min(count, totalAvailable);

  if (toAssign === 0) {
    return { assigned: 0, leads: [], errors: ["No leads available"] };
  }

  // Proportional sampling per state
  const selectedDOILeads: any[] = [];
  const alreadySelectedIds: mongoose.Types.ObjectId[] = [];

  for (const stateRow of stateCounts) {
    const proportion = stateRow.count / totalAvailable;
    const stateQuota = Math.max(1, Math.round(proportion * toAssign));
    const take = Math.min(stateQuota, stateRow.count);

    const stateLeads = await DOILead.aggregate([
      {
        $match: {
          ...baseMatch,
          state: stateRow._id,
          ...(alreadySelectedIds.length
            ? { _id: { $nin: [...alreadyAssignedIds, ...alreadySelectedIds] } }
            : {}),
        },
      },
      { $sample: { size: take } },
    ]);

    for (const lead of stateLeads) {
      selectedDOILeads.push(lead);
      alreadySelectedIds.push(lead._id);
      if (selectedDOILeads.length >= toAssign) break;
    }
    if (selectedDOILeads.length >= toAssign) break;
  }

  // Fill any remaining slots due to rounding (pick randomly from any state)
  if (selectedDOILeads.length < toAssign) {
    const gap = toAssign - selectedDOILeads.length;
    const fillMatch = {
      ...baseMatch,
      _id: { $nin: [...alreadyAssignedIds, ...alreadySelectedIds] },
    };
    const fillers = await DOILead.aggregate([
      { $match: fillMatch },
      { $sample: { size: gap } },
    ]);
    selectedDOILeads.push(...fillers);
  }

  const cooldownUntil = new Date();
  cooldownUntil.setDate(cooldownUntil.getDate() + 90);

  const assignments: any[] = [];
  const errors: string[] = [];

  for (const doiLead of selectedDOILeads) {
    try {
      // Create CRM Lead in the user's account
      const crmLead = await (Lead as any).create({
        "First Name": doiLead.firstName || "",
        "Last Name": doiLead.lastName || "",
        Email: doiLead.email,
        email: doiLead.email,
        Phone: doiLead.phone || "",
        State: doiLead.state || "",
        userEmail: userEmail.toLowerCase(),
        ...(folderId ? { folderId } : {}),
        status: "New",
      });

      // Create audit record (unique per doiLead+user)
      const assignment = await LeadAssignment.create({
        doiLeadId: doiLead._id,
        userId,
        userEmail: userEmail.toLowerCase(),
        assignedAt: new Date(),
        ...(folderId ? { folderId } : {}),
        ...(campaignId ? { campaignId } : {}),
        crmLeadId: crmLead._id,
        status: "active",
        planId,
      });

      // Update DOILead tracking
      await DOILead.updateOne(
        { _id: doiLead._id },
        {
          $set: {
            lastAssignedAt: new Date(),
            lastAssignedTo: userId,
            cooldownUntil,
          },
          $inc: { assignedCount: 1 },
        }
      );

      // Enroll in email campaign
      if (campaignId) {
        try {
          await enrollInEmailCampaign({
            leadId: crmLead._id,
            userId,
            userEmail,
            campaignId,
            leadEmail: doiLead.email,
          });
        } catch (enrollErr: any) {
          // Non-fatal: log but continue
          errors.push(
            `Enroll failed for ${doiLead.email}: ${enrollErr?.message}`
          );
        }
      }

      assignments.push(assignment);
    } catch (err: any) {
      // Duplicate key (already assigned) is silently skipped
      if (err?.code !== 11000) {
        errors.push(
          `Failed to assign ${doiLead.email}: ${err?.message || err}`
        );
      }
    }
  }

  // Debit the ProspectingPlan
  if (assignments.length > 0) {
    await ProspectingPlan.updateOne(
      { _id: planId },
      {
        $inc: {
          leadsAssigned: assignments.length,
          leadsRemaining: -assignments.length,
        },
      }
    );
  }

  return { assigned: assignments.length, leads: assignments, errors };
}

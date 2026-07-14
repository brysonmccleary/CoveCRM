// lib/ai/assistant/updateLeadStatusTool.ts
// Assistant tool: set the status on every matching lead, mirroring
// pages/api/update-lead-status.ts's contract (free-form status string,
// tenant-scoped). soldAt bookkeeping is computed per-lead via bulkWrite
// (buildSoldAtTransitionSet depends on each lead's own previous status/
// existing soldAt, so a single blanket updateMany can't apply it correctly).
import { Types } from "mongoose";
import Lead from "@/models/Lead";
import { buildSoldAtTransitionSet } from "@/lib/leads/foundationFields";
import { type QueryLeadsArgs } from "./queryLeadsTool";
import { resolveLeadIds } from "./resolveLeadIds";

export const UPDATE_LEAD_STATUS_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "update_lead_status",
    description:
      "Set the status on every one of the requesting agent's own leads matching the given filters (same filters as query_leads), or explicit leadIds — e.g. \"mark my mortgage leads in Hawaii as Not Interested\". Only changes status, not folder (use move_leads_to_folder for that).",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: 'New status, e.g. "Sold", "Not Interested", "New".' },
        leadIds: { type: "array", items: { type: "string" } },
        statusNot: { type: "string" },
        notContactedInDays: { type: "number" },
        state: { type: "string" },
        search: { type: "string" },
        folderName: { type: "string" },
        city: { type: "string" },
        zip: { type: "string" },
        source: { type: "string" },
        leadType: {
          type: "string",
          enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL", "Trucker"],
        },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
};

export type UpdateLeadStatusArgs = QueryLeadsArgs & { leadIds?: string[]; status?: string };

export async function runUpdateLeadStatusTool(userEmail: string, args: UpdateLeadStatusArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { updated: 0, error: "Unauthorized" };

  const status = String(args?.status || "").trim();
  if (!status) return { updated: 0, error: "status is required" };

  // query_leads' own "status" filter would collide with the field we're
  // setting, so this tool intentionally doesn't accept it as an input filter.
  const filterArgs: QueryLeadsArgs = { ...args, status: undefined };
  const leadIds = await resolveLeadIds(email, filterArgs);
  if (leadIds.length === 0) return { updated: 0, reason: "no_matching_leads" };

  const validIds = leadIds.filter((id) => Types.ObjectId.isValid(id));
  const existing = (await (Lead as any)
    .find({ _id: { $in: validIds }, userEmail: email })
    .select({ status: 1, soldAt: 1 })
    .lean()) as any[];

  if (existing.length === 0) return { updated: 0, reason: "no_matching_leads" };

  const now = new Date();
  const ops = existing.map((lead: any) => ({
    updateOne: {
      filter: { _id: lead._id, userEmail: email },
      update: {
        $set: {
          status,
          updatedAt: now,
          ...buildSoldAtTransitionSet({
            nextStatus: status,
            previousStatus: lead.status,
            existingSoldAt: lead.soldAt,
            now,
          }),
        },
      },
    },
  }));

  await (Lead as any).bulkWrite(ops);
  return { updated: ops.length, matched: leadIds.length, status };
}

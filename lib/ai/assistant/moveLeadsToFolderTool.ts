// lib/ai/assistant/moveLeadsToFolderTool.ts
// Assistant tool: move every matching lead into a folder (creating it if it
// doesn't exist yet), mirroring pages/api/move-lead-folder.ts's
// resolve-or-create pattern. Deliberately does NOT also set lead.status —
// kept orthogonal to update_lead_status so the two tools stay predictable
// and composable rather than silently coupled.
import { Types } from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { type QueryLeadsArgs } from "./queryLeadsTool";
import { resolveLeadIds } from "./resolveLeadIds";

function escapeRegex(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const MOVE_LEADS_TO_FOLDER_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "move_leads_to_folder",
    description:
      'Move every one of the requesting agent\'s own leads matching the given filters (same filters as query_leads), or explicit leadIds, into a folder — creating the folder if it doesn\'t already exist. This only moves the folder; it does not change lead status (use update_lead_status for that).',
    parameters: {
      type: "object",
      properties: {
        folderName: { type: "string", description: "The destination folder's name." },
        leadIds: { type: "array", items: { type: "string" } },
        status: { type: "string" },
        statusNot: { type: "string" },
        notContactedInDays: { type: "number" },
        state: { type: "string" },
        search: { type: "string" },
        sourceFolderName: { type: "string", description: "Optional source folder name." },
        city: { type: "string" },
        zip: { type: "string" },
        source: { type: "string" },
        leadType: {
          type: "string",
          enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL", "Trucker"],
        },
      },
      required: ["folderName"],
      additionalProperties: false,
    },
  },
};

export type MoveLeadsToFolderArgs = Omit<QueryLeadsArgs, "folderName"> & {
  leadIds?: string[];
  folderName?: string;
  sourceFolderName?: string;
};

export async function runMoveLeadsToFolderTool(userEmail: string, args: MoveLeadsToFolderArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { moved: 0, error: "Unauthorized" };

  const folderName = String(args?.folderName || "").trim();
  if (!folderName) return { moved: 0, error: "folderName is required" };

  const leadIds = await resolveLeadIds(email, { ...args, folderName: args.sourceFolderName });
  if (leadIds.length === 0) return { moved: 0, reason: "no_matching_leads" };

  const folder = await (Folder as any).findOneAndUpdate(
    { userEmail: email, name: new RegExp(`^${escapeRegex(folderName)}$`, "i") },
    { $setOnInsert: { userEmail: email, name: folderName, assignedDrips: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  const validIds = leadIds
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));

  const result = await (Lead as any).updateMany(
    { _id: { $in: validIds }, userEmail: email },
    { $set: { folderId: folder._id, updatedAt: new Date() } },
  );

  return {
    moved: result.modifiedCount || 0,
    matched: leadIds.length,
    folderId: String(folder._id),
    folderName: folder.name,
  };
}

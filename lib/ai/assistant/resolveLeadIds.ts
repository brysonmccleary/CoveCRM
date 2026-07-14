// lib/ai/assistant/resolveLeadIds.ts
// Shared helper: every filtered-list assistant tool (start_dial_session,
// add_note_to_leads, move_leads_to_folder, update_lead_status,
// bulk_text_leads) accepts either explicit leadIds or the same filters
// query_leads uses. This is the one place that decides which.
import Lead from "@/models/Lead";
import {
  buildAssistantLeadQuery,
  resolveAssistantFolderIds,
  type QueryLeadsArgs,
} from "./queryLeadsTool";

export async function resolveLeadIds(
  userEmail: string,
  args: QueryLeadsArgs & { leadIds?: string[] },
): Promise<string[]> {
  const explicit = Array.isArray(args?.leadIds)
    ? args.leadIds.filter((id) => typeof id === "string" && id.trim())
    : [];
  if (explicit.length > 0) return explicit;

  const folderIds = await resolveAssistantFolderIds(userEmail, args);
  const query = buildAssistantLeadQuery(userEmail, args, folderIds);
  if (!query) return [];

  // Write/dial tools must act on the complete match set. query_leads caps
  // display results at 200, but that display cap must never silently turn an
  // "all matching leads" action into a partial action.
  const rows = await (Lead as any).find(query).select({ _id: 1 }).lean();
  return (rows as any[]).map((row) => String(row._id));
}

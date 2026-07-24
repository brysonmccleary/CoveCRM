// lib/ai/assistant/addNoteToLeadsTool.ts
// Assistant tool: append a note to every matching lead. Written directly
// against the Lead model rather than proxying pages/api/update-lead-notes.ts,
// whose tenant filter uses a nonexistent "user" field instead of the real
// "userEmail" — that endpoint currently matches no real lead.
import { Types } from "mongoose";
import Lead from "@/models/Lead";
import { type QueryLeadsArgs } from "./queryLeadsTool";
import { resolveLeadIds } from "./resolveLeadIds";
import { sanitizeLeadNoteForDisplay } from "@/lib/leads/noteVisibility";

export const ADD_NOTE_TO_LEADS_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "add_note_to_leads",
    description:
      "Append a note to every one of the requesting agent's own leads matching the given filters (same filters as query_leads), or to explicit leadIds. The note is appended with a timestamp — existing notes are never overwritten.",
    parameters: {
      type: "object",
      properties: {
        note: { type: "string", description: "The note text to append." },
        leadIds: { type: "array", items: { type: "string" } },
        status: { type: "string" },
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
      required: ["note"],
      additionalProperties: false,
    },
  },
};

export type AddNoteToLeadsArgs = QueryLeadsArgs & { leadIds?: string[]; note?: string };

export async function runAddNoteToLeadsTool(userEmail: string, args: AddNoteToLeadsArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { updated: 0, error: "Unauthorized" };

  const note = sanitizeLeadNoteForDisplay(args?.note);
  if (!note) return { updated: 0, error: "note text is required" };

  const leadIds = await resolveLeadIds(email, args);
  if (leadIds.length === 0) return { updated: 0, reason: "no_matching_leads" };

  const validIds = leadIds.filter((id) => Types.ObjectId.isValid(id));
  const existing = (await (Lead as any)
    .find({ _id: { $in: validIds }, userEmail: email })
    .select({ Notes: 1 })
    .lean()) as any[];

  if (existing.length === 0) return { updated: 0, reason: "no_matching_leads" };

  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${note}`;

  const ops = existing.map((lead: any) => {
    const prior = String(lead.Notes || "").trim();
    return {
      updateOne: {
        filter: { _id: lead._id, userEmail: email },
        update: { $set: { Notes: prior ? `${prior}\n${entry}` : entry } },
      },
    };
  });

  await (Lead as any).bulkWrite(ops);
  return { updated: ops.length, matched: leadIds.length };
}

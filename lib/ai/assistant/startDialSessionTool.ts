// lib/ai/assistant/startDialSessionTool.ts
// Assistant tool: launch an AI dial session for the requesting agent's own
// leads, either from an explicit lead ID list or from the same filters
// query_leads accepts. Reuses the exact same startAiDialSession logic as
// pages/api/calls/ai-dial-session.ts — tenant scoping and all AI dial
// session gates (enabled flag, business hours, DNC/booked exclusion) are
// enforced there, not duplicated here.

import { startAiDialSession } from "@/lib/ai/dialSession/startAiDialSession";
import { type QueryLeadsArgs } from "./queryLeadsTool";
import { resolveLeadIds } from "./resolveLeadIds";

export const START_DIAL_SESSION_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "start_dial_session",
    description:
      'Start an AI dial session for the requesting agent\'s own leads. Either pass explicit leadIds (typically from a prior query_leads call) or pass the same filters query_leads accepts (status, statusNot, notContactedInDays, state, leadType) to filter-then-dial in one step — e.g. "start a dial session with my mortgage leads in Hawaii" (leadType: "Mortgage Protection", state: "HI"). Only ever dials leads owned by the requesting agent.',
    parameters: {
      type: "object",
      properties: {
        leadIds: {
          type: "array",
          items: { type: "string" },
          description: "Specific lead IDs to dial, typically from a prior query_leads result.",
        },
        status: { type: "string" },
        statusNot: { type: "string" },
        notContactedInDays: { type: "number" },
        state: { type: "string", description: 'Two-letter US state code, e.g. "HI".' },
        search: { type: "string", description: "Lead name, phone, or email." },
        folderName: { type: "string" },
        city: { type: "string" },
        zip: { type: "string" },
        source: { type: "string" },
        leadType: {
          type: "string",
          enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL", "Trucker"],
        },
        scriptKey: {
          type: "string",
          description: 'Optional AI dialer script key. Defaults to "default".',
        },
      },
      additionalProperties: false,
    },
  },
};

export type StartDialSessionArgs = QueryLeadsArgs & { leadIds?: string[]; scriptKey?: string };

export async function runStartDialSessionTool(userEmail: string, args: StartDialSessionArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { started: false, error: "Unauthorized" };

  const leadIds = await resolveLeadIds(email, args);

  if (leadIds.length === 0) {
    return { started: false, reason: "no_matching_leads", totalLeads: 0 };
  }

  const result = await startAiDialSession({ email, leadIds, scriptKey: args?.scriptKey });

  if (!result.ok) {
    return { started: false, reason: result.error, status: result.status };
  }

  return {
    started: true,
    sessionId: result.sessionId,
    totalLeads: result.totalLeads,
    message: result.message,
  };
}

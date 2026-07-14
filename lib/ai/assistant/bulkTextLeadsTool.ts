// lib/ai/assistant/bulkTextLeadsTool.ts
// Assistant tool: send a templated SMS to every matching lead. Reuses the
// canonical send path (sendSms — quiet-hours scheduling and A2P/safety gates
// already enforced there) and the canonical merge-field renderer
// (utils/renderTemplate.ts), which is also where the opt-out footer for
// this tool comes from.
//
// Two-call safety pattern: without confirm:true this only PREVIEWS how many
// leads would be texted and sends nothing. The system prompt instructs the
// model to always preview first, tell the agent the count, and only call
// again with confirm:true after the agent agrees.
import { Types } from "mongoose";
import Lead from "@/models/Lead";
import User from "@/models/User";
import { sendSms } from "@/lib/twilio/sendSMS";
import { renderTemplate, ensureOptOut, type TemplateContext } from "@/utils/renderTemplate";
import { type QueryLeadsArgs } from "./queryLeadsTool";
import { resolveLeadIds } from "./resolveLeadIds";
import { createBulkTextConfirmation, verifyBulkTextConfirmation } from "./bulkTextConfirmation";

// Sends happen synchronously within the tool call so the agent gets a real
// sent/failed count back in the same turn — kept well under typical
// serverless request time budgets, unlike query_leads' larger 200 cap.
const MAX_BULK_TEXT = 50;
const DEFAULT_BULK_TEXT = 25;

export const BULK_TEXT_LEADS_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "bulk_text_leads",
    description:
      'Send a templated SMS to every one of the requesting agent\'s own leads matching the given filters (same filters as query_leads), or explicit leadIds. Supports merge fields like {{first_name}}, {{last_name}}, {{agent_name}}. SAFETY: call this WITHOUT confirm first — it will only preview how many leads would be texted and send nothing. Tell the agent the count and get their go-ahead, THEN call it again with confirm:true to actually send. Compliance opt-out language and quiet-hours scheduling are applied automatically — never add your own opt-out text to the message.',
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: 'Message template, e.g. "Hi {{first_name}}, just checking in on your quote!"' },
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
        limit: { type: "number", description: `Max leads to text in this call. Defaults to ${DEFAULT_BULK_TEXT}, capped at ${MAX_BULK_TEXT}.` },
        confirm: { type: "boolean", description: "Set true to actually send. Omit or false to preview only." },
        confirmationToken: { type: "string", description: "Required with confirm:true. Use the token returned by the preview." },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

export type BulkTextLeadsArgs = QueryLeadsArgs & {
  leadIds?: string[];
  message?: string;
  confirm?: boolean;
  confirmationToken?: string;
};

function buildLeadName(l: any): string {
  return [l?.["First Name"], l?.["Last Name"]].filter(Boolean).join(" ") || "";
}

export async function runBulkTextLeadsTool(userEmail: string, args: BulkTextLeadsArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { error: "Unauthorized" };

  const confirmed = args?.confirm
    ? verifyBulkTextConfirmation(String(args.confirmationToken || ""), email)
    : null;
  if (args?.confirm && !confirmed) {
    return { error: "A valid, unexpired preview confirmation is required before sending" };
  }

  const message = String(confirmed?.message || args?.message || "").trim();
  if (!message) return { error: "message is required" };

  const cap = Math.min(Math.max(Number(args?.limit) || DEFAULT_BULK_TEXT, 1), MAX_BULK_TEXT);
  const allLeadIds = confirmed?.leadIds || await resolveLeadIds(email, args);
  const targetIds = allLeadIds.slice(0, cap);

  if (targetIds.length === 0) {
    return { preview: !args?.confirm, matchCount: allLeadIds.length, willTextCount: 0, reason: "no_matching_leads" };
  }

  const validIds = targetIds.filter((id) => Types.ObjectId.isValid(id));
  const leads = (await (Lead as any)
    .find({ _id: { $in: validIds }, userEmail: email })
    .select({ "First Name": 1, "Last Name": 1, Phone: 1, phone: 1 })
    .lean()) as any[];

  if (!args?.confirm) {
    return {
      preview: true,
      matchCount: allLeadIds.length,
      willTextCount: leads.length,
      sampleNames: leads.slice(0, 5).map((l) => buildLeadName(l) || "(no name on file)"),
      confirmationToken: createBulkTextConfirmation({ userEmail: email, message, leadIds: validIds }),
      note: "No messages have been sent. Call bulk_text_leads again with confirm:true to actually send.",
    };
  }

  const user = (await (User as any)
    .findOne({ email })
    .select({ name: 1, firstName: 1, lastName: 1 })
    .lean()) as any;
  const agentName = user?.name || [user?.firstName, user?.lastName].filter(Boolean).join(" ") || email.split("@")[0];

  let sent = 0;
  let failed = 0;
  let skippedNoPhone = 0;

  for (const lead of leads) {
    const phone = lead.Phone || lead.phone || "";
    if (!phone) {
      skippedNoPhone += 1;
      continue;
    }

    const ctx: TemplateContext = {
      contact: {
        first_name: lead["First Name"] || null,
        last_name: lead["Last Name"] || null,
        full_name: buildLeadName(lead) || null,
      },
      agent: {
        name: agentName,
        first_name: user?.firstName || null,
        last_name: user?.lastName || null,
        phone: null,
      },
      _meta: { leadId: String(lead._id) },
    };

    const body = ensureOptOut(renderTemplate(message, ctx));

    try {
      await sendSms({
        to: phone,
        body,
        userEmail: email,
        leadId: String(lead._id),
        source: "assistant_bulk_text",
      });
      sent += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    preview: false,
    matchCount: allLeadIds.length,
    willTextCount: leads.length,
    sent,
    failed,
    skippedNoPhone,
  };
}

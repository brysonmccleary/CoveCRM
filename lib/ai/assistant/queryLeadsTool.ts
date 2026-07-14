// lib/ai/assistant/queryLeadsTool.ts
// Assistant tool: search the requesting agent's own leads by status,
// last-contacted recency, state, and lead type. Always scoped to the
// authenticated userEmail — never a value supplied by the model.

import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { US_STATES } from "@/lib/facebook/geo/usStates";
import { normalizeLeadType } from "@/lib/leads/leadTypes";

function escapeRegex(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const QUERY_LEADS_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "query_leads",
    description:
      'Search the requesting agent\'s own leads by status, last-contacted recency, state, lead type, and/or when they were created/imported. Use this whenever the user asks to find, list, count, or filter their leads — e.g. "leads that haven\'t answered in the last week" (statusNot: "Answered", notContactedInDays: 7), "my mortgage leads in Hawaii" (leadType: "Mortgage Protection", state: "HI"), "show me all my mortgage leads" (leadType: "Mortgage Protection" only, no other filters), "how many mortgage leads do I have" (leadType: "Mortgage Protection"; use the returned "count" field, not the length of "leads", since leads is capped by limit), "leads imported this week" (createdWithinDays: 7). Only ever returns leads owned by the requesting agent.',
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          description: 'Exact lead status to match (e.g. "New", "Sold", "Not Interested"). Omit to match any status.',
        },
        statusNot: {
          type: "string",
          description: 'Exclude leads with this status (case-insensitive). Use "Answered" for "hasn\'t answered".',
        },
        notContactedInDays: {
          type: "number",
          description:
            'Only include leads whose last contact was at least this many days ago, or who have never been contacted at all. Use 7 for "in the last week".',
        },
        state: {
          type: "string",
          description:
            'Two-letter US state code to filter by, e.g. "HI". Leads only store state, not city — if the user names a city (e.g. "Phoenix"), convert it to the corresponding state code yourself (e.g. "AZ") before calling this tool.',
        },
        search: {
          type: "string",
          description: "A lead name, partial name, phone number, or email address. Use this for requests like John Smith, the 808 number, or jane@example.com.",
        },
        folderName: { type: "string", description: "Exact folder name, matched case-insensitively." },
        city: { type: "string" },
        zip: { type: "string" },
        source: { type: "string", description: "Lead source, such as Facebook, CSV, Google Sheets, or vendor API." },
        ageMin: { type: "number" },
        ageMax: { type: "number" },
        scoreMin: { type: "number" },
        scoreMax: { type: "number" },
        leadType: {
          type: "string",
          enum: ["Final Expense", "Veteran", "Mortgage Protection", "IUL", "Trucker"],
          description:
            'Lead type to filter by. Normalize shorthand: "vet" means Veteran, "mtg" or "mortgage" means Mortgage Protection, "FE" or "FEX" means Final Expense, and "CDL" or "truck" means Trucker.',
        },
        createdWithinDays: {
          type: "number",
          description: 'Only include leads created/imported within the last N days. Use 7 for "leads imported this week", 1 for "leads imported today". Combinable with any other filter.',
        },
        createdBeforeDays: {
          type: "number",
          description: "Only include leads created/imported more than N days ago.",
        },
        limit: {
          type: "number",
          description: "Maximum number of leads to return. Defaults to 50, capped at 200.",
        },
      },
      additionalProperties: false,
    },
  },
};

export type QueryLeadsArgs = {
  status?: string;
  statusNot?: string;
  notContactedInDays?: number;
  state?: string;
  search?: string;
  folderName?: string;
  city?: string;
  zip?: string;
  source?: string;
  ageMin?: number;
  ageMax?: number;
  scoreMin?: number;
  scoreMax?: number;
  leadType?: string;
  createdWithinDays?: number;
  createdBeforeDays?: number;
  limit?: number;
};

export type QueryLeadsResultLead = {
  id: string;
  name: string | null;
  phone: string | null;
  status: string | null;
  lastContactedAt: Date | string | null;
  state: string | null;
  leadType: string | null;
};

export function normalizeAssistantLeadType(leadType?: string): string | undefined {
  const raw = String(leadType || "").trim();
  if (!raw) return undefined;
  return normalizeLeadType(raw) || raw;
}

export async function resolveAssistantFolderIdsForLeadType(userEmail: string, leadType?: string): Promise<any[]> {
  const normalizedLeadType = normalizeAssistantLeadType(leadType);
  if (!userEmail || !normalizedLeadType) return [];
  try {
    const folders = await (Folder as any)
      .find({ userEmail: String(userEmail).toLowerCase(), leadType: normalizedLeadType })
      .select({ _id: 1 })
      .lean();
    return (folders as any[]).map((folder) => folder._id);
  } catch {
    // Folder metadata is a fallback. Direct lead-level matching must still
    // work if folder lookup is temporarily unavailable.
    return [];
  }
}

export async function resolveAssistantFolderIds(userEmail: string, args: QueryLeadsArgs = {}): Promise<any[]> {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return [];
  const query: Record<string, any> = { userEmail: email };
  const normalizedLeadType = normalizeAssistantLeadType(args.leadType);
  if (normalizedLeadType) query.leadType = normalizedLeadType;
  if (args.folderName?.trim()) {
    query.name = new RegExp(`^${escapeRegex(args.folderName.trim())}$`, "i");
  }
  if (!normalizedLeadType && !args.folderName?.trim()) return [];
  try {
    const folders = await (Folder as any)
      .find(query)
      .select({ _id: 1 })
      .lean();
    return (folders as any[]).map((folder) => folder._id);
  } catch {
    return [];
  }
}

export function buildAssistantLeadQuery(
  userEmail: string,
  args: QueryLeadsArgs = {},
  matchingFolderIds: any[] = [],
) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return null;

  const and: Record<string, any>[] = [{ userEmail: email }];

  if (args.search?.trim()) {
    const rawSearch = args.search.trim();
    const digits = rawSearch.replace(/\D/g, "");
    if (digits.length >= 7) {
      const phoneRx = new RegExp(escapeRegex(digits.slice(-10)), "i");
      and.push({ $or: [{ normalizedPhone: phoneRx }, { phoneLast10: phoneRx }, { Phone: phoneRx }, { phone: phoneRx }] });
    } else {
    const terms = rawSearch.split(/\s+/).filter(Boolean);
    for (const term of terms) {
      const rx = new RegExp(escapeRegex(term), "i");
      and.push({
        $or: [
          { "First Name": rx }, { "Last Name": rx }, { firstName: rx }, { lastName: rx },
          { Phone: rx }, { phone: rx }, { normalizedPhone: rx }, { phoneLast10: rx },
          { Email: rx }, { email: rx },
        ],
      });
    }
    }
  }

  if (args?.status) {
    and.push({ status: new RegExp(`^${escapeRegex(args.status)}$`, "i") });
  }
  if (args?.statusNot) {
    and.push({ status: { $not: new RegExp(`^${escapeRegex(args.statusNot)}$`, "i") } });
  }
  if (typeof args?.notContactedInDays === "number" && args.notContactedInDays > 0) {
    const cutoff = new Date(Date.now() - args.notContactedInDays * 24 * 60 * 60 * 1000);
    and.push({ $or: [{ lastContactedAt: null }, { lastContactedAt: { $lt: cutoff } }] });
  }
  if (args?.state) {
    const requestedState = String(args.state).trim();
    const stateOption = US_STATES.find(
      (option) => option.code.toLowerCase() === requestedState.toLowerCase() || option.name.toLowerCase() === requestedState.toLowerCase(),
    );
    const variants = stateOption ? [stateOption.code, stateOption.name] : [requestedState];
    and.push({ State: { $in: variants.map((value) => new RegExp(`^${escapeRegex(value)}$`, "i")) } });
  }
  const normalizedLeadType = normalizeAssistantLeadType(args?.leadType);
  if (normalizedLeadType) {
    and.push(
      matchingFolderIds.length
        ? { $or: [{ leadType: normalizedLeadType }, { folderId: { $in: matchingFolderIds } }] }
        : { leadType: normalizedLeadType },
    );
  }
  if (args.folderName?.trim()) {
    and.push({ folderId: { $in: matchingFolderIds } });
  }
  if (args.city?.trim()) {
    const rx = new RegExp(`^${escapeRegex(args.city.trim())}$`, "i");
    and.push({ $or: [{ City: rx }, { city: rx }, { "rawRow.City": rx }, { "rawRow.city": rx }] });
  }
  if (args.zip?.trim()) {
    const rx = new RegExp(`^${escapeRegex(args.zip.trim())}$`, "i");
    and.push({ $or: [{ Zip: rx }, { zip: rx }, { ZipCode: rx }, { "rawRow.Zip": rx }, { "rawRow.zip": rx }] });
  }
  if (args.source?.trim()) {
    const rx = new RegExp(escapeRegex(args.source.trim()), "i");
    and.push({ $or: [{ source: rx }, { leadSource: rx }, { sourceType: rx }] });
  }
  if (typeof args.ageMin === "number" || typeof args.ageMax === "number") {
    const convertedAge = { $convert: { input: "$Age", to: "double", onError: null, onNull: null } };
    const ageChecks: any[] = [];
    if (typeof args.ageMin === "number") ageChecks.push({ $gte: [convertedAge, args.ageMin] });
    if (typeof args.ageMax === "number") ageChecks.push({ $lte: [convertedAge, args.ageMax] });
    and.push({ $expr: ageChecks.length === 1 ? ageChecks[0] : { $and: ageChecks } });
  }
  if (typeof args.scoreMin === "number" || typeof args.scoreMax === "number") {
    const range: Record<string, number> = {};
    if (typeof args.scoreMin === "number") range.$gte = args.scoreMin;
    if (typeof args.scoreMax === "number") range.$lte = args.scoreMax;
    and.push({ $or: [{ score: range }, { aiPriorityScore: range }] });
  }
  if (typeof args?.createdWithinDays === "number" && args.createdWithinDays > 0) {
    const cutoff = new Date(Date.now() - args.createdWithinDays * 24 * 60 * 60 * 1000);
    and.push({ createdAt: { $gte: cutoff } });
  }
  if (typeof args?.createdBeforeDays === "number" && args.createdBeforeDays > 0) {
    const cutoff = new Date(Date.now() - args.createdBeforeDays * 24 * 60 * 60 * 1000);
    and.push({ createdAt: { $lt: cutoff } });
  }

  return { $and: and };
}

export async function runQueryLeadsTool(userEmail: string, args: QueryLeadsArgs) {
  const folderIds = await resolveAssistantFolderIds(userEmail, args);
  const query = buildAssistantLeadQuery(userEmail, args, folderIds);
  if (!query) return { count: 0, leads: [], error: "Unauthorized" };

  const limit = Math.min(Math.max(Number(args?.limit) || 50, 1), 200);

  // countDocuments is the TRUE total match count, independent of limit — the
  // "leads" array below may be truncated to `limit`, but "count" never is.
  // This matters for "how many X leads do I have" style questions.
  const [totalCount, leads] = await Promise.all([
    (Lead as any).countDocuments(query),
    (Lead as any)
      .find(query)
      .select({
        "First Name": 1,
        "Last Name": 1,
        Phone: 1,
        phone: 1,
        status: 1,
        lastContactedAt: 1,
        State: 1,
        leadType: 1,
      })
      .sort({ lastContactedAt: 1 })
      .limit(limit)
      .lean() as Promise<any[]>,
  ]);

  return {
    count: totalCount,
    returned: leads.length,
    truncated: totalCount > leads.length,
    leads: leads.map((l: any) => ({
      id: String(l._id),
      name: [l["First Name"], l["Last Name"]].filter(Boolean).join(" ") || null,
      phone: l.Phone || l.phone || null,
      status: l.status || null,
      lastContactedAt: l.lastContactedAt || null,
      state: l.State || null,
      leadType: l.leadType || null,
    })) as QueryLeadsResultLead[],
  };
}

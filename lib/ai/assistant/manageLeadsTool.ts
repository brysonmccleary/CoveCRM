import { Types } from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { normalizeLeadType } from "@/lib/leads/leadTypes";
import { resolveLeadIds } from "./resolveLeadIds";
import type { QueryLeadsArgs } from "./queryLeadsTool";
import { createBulkTextConfirmation, verifyBulkTextConfirmation } from "./bulkTextConfirmation";

export const MANAGE_LEADS_TOOL_DEF = {
  type: "function" as const,
  function: {
    name: "manage_leads",
    description: "Create/import pasted leads, edit lead contact details, or delete leads. Find targets using names, phones, emails, folder names, and all query_leads filters. Deletion always previews first and requires a second confirmed call.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update", "delete"] },
        leads: { type: "array", maxItems: 100, items: { type: "object", properties: {
          firstName: { type: "string" }, lastName: { type: "string" }, phone: { type: "string" },
          email: { type: "string" }, state: { type: "string" }, city: { type: "string" }, zip: { type: "string" },
          age: { type: "string" }, leadType: { type: "string" }, source: { type: "string" }, notes: { type: "string" }, folderName: { type: "string" },
        }, additionalProperties: false } },
        changes: { type: "object", properties: {
          firstName: { type: "string" }, lastName: { type: "string" }, phone: { type: "string" }, email: { type: "string" },
          state: { type: "string" }, city: { type: "string" }, zip: { type: "string" }, age: { type: "string" },
          leadType: { type: "string" }, source: { type: "string" }, notes: { type: "string" },
        }, additionalProperties: false },
        leadIds: { type: "array", items: { type: "string" } },
        search: { type: "string" }, folderName: { type: "string" }, status: { type: "string" }, state: { type: "string" },
        leadType: { type: "string" }, city: { type: "string" }, zip: { type: "string" }, source: { type: "string" },
        confirm: { type: "boolean" },
        confirmationToken: { type: "string" },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
};

type NewLead = Record<string, any>;
type ManageArgs = QueryLeadsArgs & { action: "create" | "update" | "delete"; leadIds?: string[]; leads?: NewLead[]; changes?: NewLead; confirm?: boolean; confirmationToken?: string };

async function folderIdFor(email: string, name?: string) {
  if (!name?.trim()) return undefined;
  const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const folder = await (Folder as any).findOneAndUpdate(
    { userEmail: email, name: new RegExp(`^${escaped}$`, "i") },
    { $setOnInsert: { userEmail: email, name: name.trim(), assignedDrips: [] } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return folder._id;
}

function createDoc(email: string, row: NewLead, folderId?: any) {
  const type = normalizeLeadType(row.leadType);
  return {
    userEmail: email, "First Name": row.firstName?.trim(), "Last Name": row.lastName?.trim(),
    Phone: row.phone?.trim(), Email: row.email?.trim(), email: row.email?.trim().toLowerCase(), State: row.state?.trim(),
    Age: row.age?.trim(), Notes: row.notes?.trim(), source: row.source?.trim() || "assistant",
    ...(type ? { leadType: type } : {}), ...(folderId ? { folderId } : {}),
    rawRow: { ...(row.city ? { City: row.city } : {}), ...(row.zip ? { Zip: row.zip } : {}) },
  };
}

export async function runManageLeadsTool(userEmail: string, args: ManageArgs) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { ok: false, error: "Unauthorized" };
  if (args.action === "create") {
    const rows = Array.isArray(args.leads) ? args.leads.slice(0, 100) : [];
    if (!rows.length) return { ok: false, error: "leads are required" };
    const docs = [];
    for (const row of rows) docs.push(createDoc(email, row, await folderIdFor(email, row.folderName)));
    const created = await (Lead as any).insertMany(docs);
    return { ok: true, created: created.length, leadIds: created.map((lead: any) => String(lead._id)) };
  }

  const ids = await resolveLeadIds(email, args);
  const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
  if (!validIds.length) return { ok: true, matched: 0 };
  if (args.action === "delete") {
    if (!args.confirm) return { ok: true, preview: true, matched: validIds.length, confirmationToken: createBulkTextConfirmation({ userEmail: email, message: "delete_leads", leadIds: validIds }), note: "Nothing deleted. Ask for confirmation." };
    const confirmation = verifyBulkTextConfirmation(String(args.confirmationToken || ""), email);
    if (!confirmation || confirmation.message !== "delete_leads") return { ok: false, error: "A valid delete preview confirmation is required" };
    const result = await (Lead as any).deleteMany({ _id: { $in: confirmation.leadIds }, userEmail: email });
    return { ok: true, deleted: result.deletedCount || 0 };
  }

  const c = args.changes || {};
  const set: Record<string, any> = {};
  if (c.firstName !== undefined) set["First Name"] = c.firstName;
  if (c.lastName !== undefined) set["Last Name"] = c.lastName;
  if (c.phone !== undefined) set.Phone = c.phone;
  if (c.email !== undefined) { set.Email = c.email; set.email = String(c.email).toLowerCase(); }
  if (c.state !== undefined) set.State = c.state;
  if (c.age !== undefined) set.Age = c.age;
  if (c.notes !== undefined) set.Notes = c.notes;
  if (c.source !== undefined) set.source = c.source;
  if (c.city !== undefined) set["rawRow.City"] = c.city;
  if (c.zip !== undefined) set["rawRow.Zip"] = c.zip;
  if (c.leadType !== undefined) set.leadType = normalizeLeadType(c.leadType) || c.leadType;
  if (!Object.keys(set).length) return { ok: false, error: "changes are required" };
  const result = await (Lead as any).updateMany({ _id: { $in: validIds }, userEmail: email }, { $set: set });
  return { ok: true, matched: result.matchedCount || validIds.length, updated: result.modifiedCount || 0 };
}

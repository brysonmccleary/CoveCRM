import Folder from "@/models/Folder";
import { normalizeLeadType } from "@/lib/leads/leadTypes";

const SCRIPTS = ["default", "final_expense", "mortgage_protection", "iul_cash_value", "veteran_leads", "veteran_iul", "veteran_mortgage", "trucker_leads", "trucker_iul", "trucker_mortgage", "generic_life", "spanish_final_expense", "spanish_mortgage", "spanish_iul"];

export const MANAGE_FOLDER_TOOL_DEF = { type: "function" as const, function: {
  name: "manage_folder",
  description: "Create or rename a folder and change its lead type, AI calling script, AI first-call switch, first-call delay, or real-time-only setting. Understands common lead-type shorthand.",
  parameters: { type: "object", properties: {
    folderName: { type: "string" }, createIfMissing: { type: "boolean" }, newName: { type: "string" },
    leadType: { type: "string" }, clearLeadType: { type: "boolean" }, aiScriptKey: { type: "string" },
    aiFirstCallEnabled: { type: "boolean" }, aiFirstCallDelayMinutes: { type: "number" }, aiRealTimeOnly: { type: "boolean" },
  }, required: ["folderName"], additionalProperties: false },
} };

export async function runManageFolderTool(userEmail: string, args: any) {
  const email = String(userEmail || "").toLowerCase();
  if (!email) return { ok: false, error: "Unauthorized" };
  const name = String(args.folderName || "").trim();
  if (!name) return { ok: false, error: "folderName is required" };
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const set: Record<string, any> = {};
  if (args.newName?.trim()) set.name = args.newName.trim();
  if (args.leadType !== undefined) {
    const normalized = normalizeLeadType(args.leadType);
    if (!normalized) return { ok: false, error: "Unknown lead type" };
    set.leadType = normalized;
  }
  if (args.aiScriptKey !== undefined) set.aiScriptKey = SCRIPTS.includes(args.aiScriptKey) ? args.aiScriptKey : "default";
  if (typeof args.aiFirstCallEnabled === "boolean") { set.aiFirstCallEnabled = args.aiFirstCallEnabled; set.aiEnabledAt = args.aiFirstCallEnabled ? new Date() : null; }
  if (typeof args.aiFirstCallDelayMinutes === "number") set.aiFirstCallDelayMinutes = Math.min(60, Math.max(0, Math.round(args.aiFirstCallDelayMinutes)));
  if (typeof args.aiRealTimeOnly === "boolean") set.aiRealTimeOnly = args.aiRealTimeOnly;
  const update: any = { $set: set, $setOnInsert: { userEmail: email, name, assignedDrips: [] } };
  if (args.clearLeadType) update.$unset = { leadType: "" };
  const folder = await (Folder as any).findOneAndUpdate(
    { userEmail: email, name: new RegExp(`^${escaped}$`, "i") }, update,
    { upsert: args.createIfMissing === true, new: true, setDefaultsOnInsert: true },
  );
  if (!folder) return { ok: false, error: "Folder not found" };
  return { ok: true, folderId: String(folder._id), folderName: folder.name, leadType: folder.leadType || null, aiScriptKey: folder.aiScriptKey, aiFirstCallEnabled: !!folder.aiFirstCallEnabled };
}

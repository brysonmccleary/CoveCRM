// /lib/utils/syncSheetRow.ts
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { sendInitialDrip } from "@/utils/sendInitialDrip";
import type { ILead } from "@/models/Lead";
import type { Types } from "mongoose";
import { isSystemFolderName as systemUtilIsSystem } from "@/lib/systemFolders";

// Local guard (belt & suspenders)
const BLOCKED = new Set(["sold", "not interested", "booked", "booked appointment"]);
const isSystemFolderName = (name?: string | null) => {
  const s = String(name ?? "").trim().toLowerCase();
  return BLOCKED.has(s) || systemUtilIsSystem?.(name) === true;
};

export async function syncSheetRow(row: {
  name: string;
  email: string;
  phone: string;
  notes?: string;
  folderName: string;
  userEmail: string;
  additionalFields?: Record<string, unknown>;
}) {
  await dbConnect();

  // Guard against system folders
  if (isSystemFolderName(row.folderName)) {
    throw new Error(`Cannot sync into system folder '${row.folderName}'.`);
  }

  // Create/find the destination folder for the user
  let folder = await Folder.findOne({
    name: row.folderName,
    userEmail: row.userEmail,
  });
  if (!folder) {
    folder = await Folder.create({ name: row.folderName, userEmail: row.userEmail });
  }

  const leadData: ILead = {
    "First Name": (row.additionalFields?.["First Name"] as string) || "",
    "Last Name": (row.additionalFields?.["Last Name"] as string) || "",
    Email: (row.email || "").toLowerCase().trim(),
    Phone: row.phone,
    Notes: row.notes || "",
    State: (row.additionalFields?.State as string) || "",
    Age: (row.additionalFields?.Age as string) || "",
    Beneficiary: (row.additionalFields?.Beneficiary as string) || "",
    "Coverage Amount":
      (row.additionalFields?.["Coverage Amount"] as string) || "",
    userEmail: row.userEmail,
    folderId: folder._id as Types.ObjectId,
    status: "New", // Sheets sync may set disposition later via another path; do not move folder here.
  };

  const newLead = await Lead.create(leadData);

  const leadObj = (
    typeof (newLead as any).toObject === "function"
      ? (newLead as any).toObject()
      : JSON.parse(JSON.stringify(newLead))
  ) as ILead & { _id: Types.ObjectId };

  const dripReadyLead = {
    ...leadObj,
    name: row.name,
    phone: row.phone,
    folderName: String((folder as any).name || row.folderName),
    agentName: (folder as any).agentName ?? undefined,
    agentPhone: (folder as any).agentPhone ?? undefined,
  };

  if ((folder as any).assignedDrip) {
    await sendInitialDrip(dripReadyLead);
  }

  return newLead;
}

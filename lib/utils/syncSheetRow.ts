// lib/utils/syncSheetRow.ts
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { sendInitialDrip } from "@/utils/sendInitialDrip";
import type { ILead } from "@/models/Lead";
import type { Types } from "mongoose";

interface SheetRow {
  name: string;
  email: string;
  phone: string;
  notes?: string;
  folderName: string;
  userEmail: string;
  additionalFields?: Record<string, unknown>;
}

export async function syncSheetRow(row: SheetRow) {
  await dbConnect();

  const folder = await Folder.findOne({
    name: row.folderName,
    userEmail: row.userEmail,
  });

  if (!folder) {
    throw new Error(`Folder '${row.folderName}' not found for user.`);
  }

  const leadData: ILead = {
    "First Name": (row.additionalFields?.["First Name"] as string) || "",
    "Last Name": (row.additionalFields?.["Last Name"] as string) || "",
    Email: row.email,
    Phone: row.phone,
    Notes: row.notes || "",
    State: (row.additionalFields?.State as string) || "",
    Age: (row.additionalFields?.Age as string) || "",
    Beneficiary: (row.additionalFields?.Beneficiary as string) || "",
    "Coverage Amount": (row.additionalFields?.["Coverage Amount"] as string) || "",
    userEmail: row.userEmail,
    folderId: (folder._id as unknown) as Types.ObjectId,
    status: "New",
  };

  const newLead = await Lead.create(leadData);

  // ✅ Use toObject() instead of private _doc
  const leadObj = (typeof newLead.toObject === "function"
    ? newLead.toObject()
    : JSON.parse(JSON.stringify(newLead))) as ILead & { _id: Types.ObjectId };

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

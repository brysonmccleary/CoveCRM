// utils/syncSheetRow.ts
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { sendInitialDrip } from "@/utils/sendInitialDrip";

interface SheetRow {
  name: string;
  email: string;
  phone: string;
  notes?: string;
  folderName: string;
  userEmail: string;
  additionalFields?: Record<string, any>;
}

export async function syncSheetRow(row: SheetRow) {
  await dbConnect();

  const folder = await Folder.findOne({
    name: row.folderName,
    userEmail: row.userEmail,
  });

  if (!folder) throw new Error(`Folder '${row.folderName}' not found for user.`);

  // 👇 Create full lead data
  const leadData = {
    "First Name": row.additionalFields?.["First Name"] || "",
    "Last Name": row.additionalFields?.["Last Name"] || "",
    Email: row.email,
    Phone: row.phone,
    Notes: row.notes || "",
    State: row.additionalFields?.State || "",
    Age: row.additionalFields?.Age || "",
    Beneficiary: row.additionalFields?.Beneficiary || "",
    "Coverage Amount": row.additionalFields?.["Coverage Amount"] || "",
    userEmail: row.userEmail,
    folderId: folder._id,
    status: "New",
  };

  const newLead = await Lead.create(leadData);

  // 👇 Prepare lead object for sendInitialDrip
  const dripReadyLead = {
    ...newLead._doc,
    name: row.name,
    phone: row.phone,
    folderName: folder.name,
    agentName: folder.agentName || undefined,  // fallback if exists
    agentPhone: folder.agentPhone || undefined,
  };

  if (folder.assignedDrip) {
    await sendInitialDrip(dripReadyLead);
  }

  return newLead;
}

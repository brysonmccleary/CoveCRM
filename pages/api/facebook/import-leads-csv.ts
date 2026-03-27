// pages/api/facebook/import-leads-csv.ts
// POST — multipart CSV upload from Facebook Lead Ads export
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import formidable from "formidable";
import fs from "fs";
import Papa from "papaparse";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadEntry from "@/models/FBLeadEntry";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import User from "@/models/User";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { sanitizeLeadType } from "@/lib/mongo/leads";
import mongoose from "mongoose";

export const config = { api: { bodyParser: false } };

const FB_LEAD_TYPE_TO_CRM: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Final Expense",
};

function parseName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const { campaignId } = req.query as { campaignId?: string };
  if (!campaignId) return res.status(400).json({ error: "campaignId query param required" });

  const campaign = await FBLeadCampaign.findOne({
    _id: campaignId,
    userEmail: session.user.email.toLowerCase(),
  }).lean();
  if (!campaign) return res.status(404).json({ error: "Campaign not found" });

  const user = await User.findOne({ email: session.user.email }).select("_id").lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  // Parse multipart form
  const form = formidable({ keepExtensions: true, maxFileSize: 10 * 1024 * 1024 });
  let csvContent = "";
  try {
    const [, files] = await form.parse(req);
    const fileField = files.file ?? files.csv ?? Object.values(files)[0];
    const uploaded = Array.isArray(fileField) ? fileField[0] : fileField;
    if (!uploaded?.filepath) {
      return res.status(400).json({ error: "No CSV file provided" });
    }
    csvContent = fs.readFileSync(uploaded.filepath, "utf-8");
  } catch (err: any) {
    return res.status(400).json({ error: "Failed to read uploaded file" });
  }

  // Parse CSV — Facebook export standard columns
  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0) {
    console.warn("[import-leads-csv] CSV parse warnings:", parsed.errors.slice(0, 3));
  }

  const rows = parsed.data;
  if (rows.length === 0) return res.status(400).json({ error: "CSV has no data rows" });

  // Find or create folder for this campaign
  const folderName = `FB: ${campaign.campaignName}`;
  let folder = await Folder.findOne({
    userEmail: session.user.email.toLowerCase(),
    name: folderName,
  });
  if (!folder) {
    folder = await Folder.create({
      name: folderName,
      userEmail: session.user.email.toLowerCase(),
      assignedDrips: [],
    });
  }

  const userId = (user as any)._id as mongoose.Types.ObjectId;
  const crmLeadType = FB_LEAD_TYPE_TO_CRM[(campaign as any).leadType] ?? "Final Expense";

  let imported = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      // Facebook Lead Ads standard column names (case-insensitive handling)
      const fullName =
        row["full_name"] ?? row["Full Name"] ?? row["name"] ?? "";
      const email = (row["email"] ?? row["Email"] ?? row["email_address"] ?? "").toLowerCase().trim();
      const phone = row["phone_number"] ?? row["Phone Number"] ?? row["phone"] ?? "";
      const fbLeadId = row["id"] ?? row["lead_id"] ?? "";

      const { firstName, lastName } = parseName(fullName);
      const normalizedPhone = phone.replace(/\D+/g, "");

      // Create FBLeadEntry
      const entry = await FBLeadEntry.create({
        userId,
        userEmail: session.user.email.toLowerCase(),
        campaignId: (campaign as any)._id,
        firstName,
        lastName,
        email,
        phone,
        leadType: (campaign as any).leadType,
        source: "csv",
        facebookLeadId: fbLeadId || undefined,
        folderId: folder._id,
        importedToCrm: true,
        importedAt: new Date(),
      });

      // Create CRM Lead
      const crmLead = await Lead.create({
        "First Name": firstName,
        "Last Name": lastName,
        Email: email,
        email,
        Phone: phone,
        phoneLast10: normalizedPhone.slice(-10),
        normalizedPhone,
        userEmail: session.user.email.toLowerCase(),
        folderId: folder._id,
        leadType: crmLeadType,
        status: "New",
        rawRow: row,
      });

      // Link back
      await FBLeadEntry.updateOne({ _id: entry._id }, { $set: { crmLeadId: crmLead._id } });

      // Enroll in drip if folder has watchers
      await enrollOnNewLeadIfWatched({
        userEmail: session.user.email.toLowerCase(),
        folderId: String(folder._id),
        leadId: String(crmLead._id),
        startMode: "now",
        source: "manual-lead",
      });

      imported++;
    } catch (err: any) {
      // Skip duplicate key errors silently
      if (err?.code !== 11000) {
        console.error("[import-leads-csv] Row error:", err?.message);
      }
      failed++;
    }
  }

  // Update campaign stats
  await FBLeadCampaign.updateOne(
    { _id: (campaign as any)._id },
    { $inc: { totalLeads: imported } }
  );

  return res.status(200).json({
    ok: true,
    imported,
    failed,
    folderId: String(folder._id),
    folderName,
  });
}

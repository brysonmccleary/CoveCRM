// pages/api/cron/sync-facebook-sheets.ts
// Cron — runs every 5 minutes, syncs new leads from connected Google Sheets via Apps Script
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import FBLeadCampaign from "@/models/FBLeadCampaign";
import FBLeadEntry from "@/models/FBLeadEntry";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import User from "@/models/User";
import { enrollOnNewLeadIfWatched } from "@/lib/drips/enrollOnNewLead";
import { scoreLeadOnArrival } from "@/lib/leads/scoreLead";
import { trackLeadSourceStat } from "@/lib/leads/trackLeadSourceStat";
import { checkDuplicate } from "@/lib/leads/checkDuplicate";
import axios from "axios";

export const config = { maxDuration: 60 };

const FB_LEAD_TYPE_TO_CRM: Record<string, string> = {
  final_expense: "Final Expense",
  iul: "IUL",
  mortgage_protection: "Mortgage Protection",
  veteran: "Veteran",
  trucker: "Final Expense",
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const campaigns = await FBLeadCampaign.find({
    status: "active",
    appsScriptUrl: { $exists: true, $ne: "" },
  }).lean();

  console.info(`[sync-fb-sheets] Processing ${campaigns.length} campaign(s)`);

  let totalImported = 0;
  let totalErrors = 0;

  for (const campaign of campaigns) {
    const c = campaign as any;
    try {
      const sinceRow = c.lastSyncedRow ?? 1;
      const url = `${c.appsScriptUrl}?action=getLeads&sinceRow=${sinceRow}`;

      const response = await axios.get(url, { timeout: 15000 });
      const { leads = [], lastRow } = response.data ?? {};

      if (!Array.isArray(leads) || leads.length === 0) continue;

      const user = await User.findOne({ email: c.userEmail }).select("_id").lean();
      if (!user) continue;

      const folderName = `FB: ${c.campaignName}`;
      let folder = await Folder.findOne({ userEmail: c.userEmail, name: folderName });
      if (!folder) {
        folder = await Folder.create({
          name: folderName,
          userEmail: c.userEmail,
          assignedDrips: [],
        });
      }

      let maxRow = sinceRow;

      for (const row of leads) {
        try {
          const firstName = String(row.firstName ?? "");
          const lastName = String(row.lastName ?? "");
          const email = String(row.email ?? "").toLowerCase().trim();
          const phone = String(row.phone ?? "");
          const normalizedPhone = phone.replace(/\D+/g, "");
          const crmLeadType = FB_LEAD_TYPE_TO_CRM[c.leadType] ?? "Final Expense";

          // Skip if email already imported for this campaign
          if (email) {
            const dup = await FBLeadEntry.findOne({ userEmail: c.userEmail, campaignId: c._id, email }).lean();
            if (dup) {
              if (row.rowNumber > maxRow) maxRow = row.rowNumber;
              continue;
            }
          }

          const entry = await FBLeadEntry.create({
            userId: (user as any)._id,
            userEmail: c.userEmail,
            campaignId: c._id,
            firstName,
            lastName,
            email,
            phone,
            leadType: c.leadType,
            source: "google_sheet_sync",
            folderId: folder._id,
            importedToCrm: true,
            importedAt: new Date(),
          });

          const crmLead = await Lead.create({
            "First Name": firstName,
            "Last Name": lastName,
            Email: email,
            email,
            Phone: phone,
            phoneLast10: normalizedPhone.slice(-10),
            normalizedPhone,
            userEmail: c.userEmail,
            folderId: folder._id,
            leadType: crmLeadType,
            status: "New",
          });

          await FBLeadEntry.updateOne({ _id: entry._id }, { $set: { crmLeadId: crmLead._id } });

          // Score and track source
          try {
            await scoreLeadOnArrival(String(crmLead._id), "google_sheet");
            await trackLeadSourceStat(c.userEmail, "google_sheet");
          } catch (_) {}

          await enrollOnNewLeadIfWatched({
            userEmail: c.userEmail,
            folderId: String(folder._id),
            leadId: String(crmLead._id),
            startMode: "now",
            source: "manual-lead",
          });

          if (row.rowNumber > maxRow) maxRow = row.rowNumber;
          totalImported++;
        } catch (rowErr: any) {
          if (rowErr?.code !== 11000) {
            console.error(`[sync-fb-sheets] Row error (campaign ${c._id}):`, rowErr?.message);
          }
          totalErrors++;
        }
      }

      // Update lastSyncedRow and lastSheetSyncAt
      await FBLeadCampaign.updateOne(
        { _id: c._id },
        {
          $set: { lastSyncedRow: maxRow, lastSheetSyncAt: new Date() },
          $inc: { totalLeads: leads.length },
        }
      );

      console.info(`[sync-fb-sheets] Campaign ${c.campaignName}: imported ${leads.length} rows`);
    } catch (err: any) {
      console.error(`[sync-fb-sheets] Campaign ${c._id} error:`, err?.message);
      totalErrors++;
    }
  }

  return res.status(200).json({
    ok: true,
    campaigns: campaigns.length,
    totalImported,
    totalErrors,
  });
}

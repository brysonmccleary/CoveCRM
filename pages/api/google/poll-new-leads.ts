// pages/api/poll-new-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import { sendInitialDrip } from "@/utils/sendInitialDrip";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  await dbConnect();

  const users = await User.find({ "googleSheets.syncedSheets": { $exists: true, $ne: [] } });

  for (const user of users) {
    if (!user.googleSheets?.refreshToken) continue;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!
    );
    oauth2Client.setCredentials({ refresh_token: user.googleSheets.refreshToken });

    const sheetsAPI = google.sheets({ version: "v4", auth: oauth2Client });

    for (const sync of user.googleSheets.syncedSheets) {
      const { sheetId, folderId } = sync;

      try {
        const response = await sheetsAPI.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range: "A2:Z1000", // adjust if needed
        });

        const rows = response.data.values || [];
        const existingLeads = await Lead.find({ folderId }).select("externalId");
        const existingIds = new Set(existingLeads.map((l: any) => l.externalId));

        const folder = await Folder.findById(folderId);
        if (!folder) continue;

        for (const row of rows) {
          const firstName = row[0]?.trim();
          const lastName = row[1]?.trim();
          const email = row[2]?.trim();
          const phone = row[3]?.trim();
          const notes = row[4]?.trim();
          const state = row[5]?.trim();
          const age = row[6]?.trim();
          const beneficiary = row[7]?.trim();
          const coverageAmount = row[8]?.trim();

          if (!firstName || !phone) continue;

          const fullName = `${firstName} ${lastName}`.trim();
          const externalId = `${sheetId}-${phone}`;

          if (existingIds.has(externalId)) continue;

          const newLead = await Lead.create({
            "First Name": firstName,
            "Last Name": lastName,
            name: fullName,
            Email: email,
            Phone: phone,
            Notes: notes,
            State: state,
            Age: age,
            Beneficiary: beneficiary,
            "Coverage Amount": coverageAmount,
            userEmail: user.email,
            folderId,
            externalId,
            status: "New",
          });

          const dripReadyLead = {
            ...newLead._doc,
            name: fullName,
            phone,
            folderName: folder.name,
            agentName: folder.agentName || user.name || "your licensed agent",
            agentPhone: folder.agentPhone || "N/A",
          };

          if (folder.assignedDrip) {
            await sendInitialDrip(dripReadyLead);
          }
        }
      } catch (err) {
        console.error(`Error syncing sheet ${sheetId} for ${user.email}:`, err);
      }
    }
  }

  return res.status(200).json({ message: "Google Sheets polling complete" });
}

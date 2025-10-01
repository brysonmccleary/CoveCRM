// /pages/api/google/poll-new-leads.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import mongoose from "mongoose";
import { sendInitialDrip } from "@/utils/sendInitialDrip";

// Never force Google Sheets leads into these catch-all/system folders
const SYSTEM_FOLDERS = new Set(["Sold", "Not Interested", "Booked Appointment", "No Show"]);

const normPhone = (v: any) => String(v ?? "").replace(/\D+/g, "");
const normEmail = (v: any) => String(v ?? "").trim().toLowerCase();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  await dbConnect();

  // Users who have any sheet links (legacy or normalized)
  const users = await User.find({
    $or: [
      { "googleSheets.syncedSheets.0": { $exists: true } },
      { "googleSheets.sheets.0": { $exists: true } },
    ],
  }).lean();

  for (const user of users) {
    // OAuth
    // prefer current container, fall back to legacy
    const gs: any = (user as any).googleSheets || {};
    const legacyTok: any = (user as any).googleTokens || {};
    const refreshToken = gs?.refreshToken || legacyTok?.refreshToken;
    if (!refreshToken) continue;

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI! // keep your current redirect
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const sheetsAPI = google.sheets({ version: "v4", auth: oauth2Client });
    const driveAPI = google.drive({ version: "v3", auth: oauth2Client });

    // Merge both shapes; handle legacy {sheetId, sheetName, folderId} and new {spreadsheetId, title, folderId}
    const configs: any[] = [
      ...((gs.syncedSheets && Array.isArray(gs.syncedSheets)) ? gs.syncedSheets : []),
      ...((gs.sheets && Array.isArray(gs.sheets)) ? gs.sheets : []),
    ];

    // Deduplicate links by spreadsheetId:title (favor normalized)
    const byKey = new Map<string, any>();
    for (const c of configs) {
      const spreadsheetId = c.spreadsheetId || c.sheetId;  // legacy sheetId actually spreadsheetId
      const title = c.title || c.sheetName;
      if (!spreadsheetId || !title) continue;
      const key = `${spreadsheetId}:${title}`;
      const isNormalized = !!c.spreadsheetId;
      const existing = byKey.get(key);
      if (!existing || (isNormalized && !existing.spreadsheetId)) byKey.set(key, c);
    }

    for (const sync of byKey.values()) {
      const spreadsheetId: string = sync.spreadsheetId || sync.sheetId;
      const title: string = sync.title || sync.sheetName;
      if (!spreadsheetId || !title) continue;

      // Compute / ensure the canonical destination folder.
      // If the existing linked folder is a system folder (e.g., Sold), we ignore it and use canonical.
      let canonicalFolder = null as any;

      try {
        const gfile = await driveAPI.files.get({ fileId: spreadsheetId, fields: "name" });
        const driveName = gfile.data.name || "Imported Leads";
        const canonicalName = `Google Sheet — ${driveName} — ${title}`;

        // Create/find canonical (never a system folder)
        canonicalFolder = await Folder.findOneAndUpdate(
          { userEmail: (user as any).email.toLowerCase(), name: canonicalName },
          { $setOnInsert: { userEmail: (user as any).email.toLowerCase(), name: canonicalName, source: "google-sheets" } },
          { new: true, upsert: true }
        );
      } catch (e) {
        console.warn(`poll-new-leads: could not resolve canonical folder for ${spreadsheetId}:${title}`, (e as any)?.message || e);
        continue;
      }

      if (!canonicalFolder?._id) continue;
      const targetFolderId = canonicalFolder._id as mongoose.Types.ObjectId;

      // Read rows from the correct tab (A2 onward; simple legacy mapping)
      let rows: string[][] = [];
      try {
        const resp = await sheetsAPI.spreadsheets.values.get({
          spreadsheetId,
          range: `'${title}'!A2:Z1000`,
          majorDimension: "ROWS",
        });
        rows = (resp.data.values || []) as string[][];
      } catch (e) {
        console.warn(`poll-new-leads: read error ${spreadsheetId}:${title}`, (e as any)?.message || e);
        continue;
      }

      // We will dedupe/update ACROSS THE USER, not only within the folder.
      // This prevents creating a duplicate in Sold (or anywhere) when the poller already inserted in canonical.
      for (const row of rows) {
        // Legacy column mapping (keep as-is)
        const firstName = (row[0] ?? "").trim();
        const lastName  = (row[1] ?? "").trim();
        const emailRaw  = (row[2] ?? "").trim();
        const phoneRaw  = (row[3] ?? "").trim();
        const notes     = (row[4] ?? "").trim();
        const state     = (row[5] ?? "").trim();
        const age       = (row[6] ?? "").trim();
        const beneficiary     = (row[7] ?? "").trim();
        const coverageAmount  = (row[8] ?? "").trim();

        const p = normPhone(phoneRaw);
        const e = normEmail(emailRaw);
        if (!p && !e) continue;

        const fullName = `${firstName} ${lastName}`.trim();

        // Find any existing lead for this user by phone/email, regardless of folder
        const or: any[] = [];
        if (p) or.push({ normalizedPhone: p }, { phoneLast10: p.slice(-10) });
        if (e) or.push({ Email: e }, { email: e });

        const existing = await Lead.findOne({ userEmail: (user as any).email.toLowerCase(), ...(or.length ? { $or: or } : {}) })
          .select("_id folderId")
          .lean<{ _id: mongoose.Types.ObjectId, folderId?: mongoose.Types.ObjectId } | null>();

        // Prepare doc fields (compatible with the rest of the app)
        const doc: Record<string, any> = {
          "First Name": firstName || undefined,
          "Last Name": lastName  || undefined,
          Email: e || undefined,
          email: e || undefined,
          Phone: phoneRaw || undefined,
          normalizedPhone: p || undefined,
          phoneLast10: p ? p.slice(-10) : undefined,
          Notes: notes || undefined,
          State: state || undefined,
          Age: age || undefined,
          Beneficiary: beneficiary || undefined,
          "Coverage Amount": coverageAmount || undefined,
          userEmail: (user as any).email.toLowerCase(),
          source: "google-sheets",
          // folderId decided below
        };

        if (!existing) {
          // Create in the canonical Google Sheet folder
          doc.folderId = targetFolderId;
          doc.status = "New";

          const created = await Lead.create(doc);

          // Optional drip
          try {
            const folder = await Folder.findById(targetFolderId);
            if ((folder as any)?.assignedDrip) {
              await sendInitialDrip({
                ...created.toObject(),
                name: fullName,
                phone: phoneRaw,
                folderName: folder?.name,
                agentName: (folder as any)?.agentName || (user as any).name || "your agent",
                agentPhone: (folder as any)?.agentPhone || "N/A",
              });
            }
          } catch (e) {
            console.warn("poll-new-leads: sendInitialDrip warning", (e as any)?.message || e);
          }
        } else {
          // Update existing in place; if its folder is a system folder, move it back to canonical.
          let update: any = { $set: { ...doc, updatedAt: new Date() } };

          try {
            // Check the existing folder's name only if present
            if (existing.folderId) {
              const f = await Folder.findById(existing.folderId).select("name").lean<{ name?: string } | null>();
              if (f?.name && SYSTEM_FOLDERS.has(f.name)) {
                update.$set.folderId = targetFolderId;
              }
            } else {
              // No folder? put it into canonical
              update.$set.folderId = targetFolderId;
            }
          } catch { /* ignore */ }

          await Lead.updateOne({ _id: existing._id }, update);
        }
      }
    }
  }

  return res.status(200).json({ message: "Google Sheets polling complete" });
}

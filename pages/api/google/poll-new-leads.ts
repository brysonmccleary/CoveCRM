import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import { sendInitialDrip } from "@/utils/sendInitialDrip";

/** ---------- helpers ---------- */
const norm = (s: any) =>
  String(s ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
const digits = (s: any) => String(s ?? "").replace(/\D+/g, "");
const phoneLast10 = (s: any) => {
  const d = digits(s);
  return d ? d.slice(-10) : "";
};
const emailLc = (s: any) => {
  const v = String(s ?? "").trim().toLowerCase();
  return v || "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  await dbConnect();

  // pull users who have *either* array populated
  const users = await User.find({
    $or: [
      { "googleSheets.syncedSheets.0": { $exists: true } },
      { "googleSheets.sheets.0": { $exists: true } },
    ],
  }).select({ email: 1, googleSheets: 1, googleTokens: 1, name: 1 });

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const user of users) {
    const refreshToken =
      (user as any).googleSheets?.refreshToken ||
      (user as any).googleTokens?.refreshToken;
    if (!refreshToken) continue;

    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      process.env.GOOGLE_REDIRECT_URI!
    );
    oauth2.setCredentials({ refresh_token: refreshToken });
    const sheetsAPI = google.sheets({ version: "v4", auth: oauth2 });

    // Support both shapes you save in save-sheet-link.ts
    const configs: any[] =
      (user as any).googleSheets?.syncedSheets?.length
        ? (user as any).googleSheets.syncedSheets
        : (user as any).googleSheets?.sheets || [];

    if (!Array.isArray(configs) || !configs.length) continue;

    for (const cfg of configs) {
      // Two naming styles exist in your DB: { spreadsheetId, title, folderId } OR { sheetId, sheetName, folderId }
      const spreadsheetId = (cfg as any).spreadsheetId || (cfg as any).sheetId;
      const tabTitle = (cfg as any).title || (cfg as any).sheetName;
      const folderId = (cfg as any).folderId;

      if (!spreadsheetId || !tabTitle || !folderId) {
        continue; // minimal guard; don’t mutate schema here
      }

      // read header + all rows
      const resp = await sheetsAPI.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tabTitle.replace(/'/g, "''")}'!A1:ZZ`,
        majorDimension: "ROWS",
      });
      const rows = (resp.data.values || []) as string[][];
      if (rows.length < 2) continue; // header only

      const headers = (rows[0] || []).map((h) => String(h ?? "").trim());
      const headerIndex: Record<string, number> = {};
      headers.forEach((h, i) => (headerIndex[norm(h)] = i));

      // tolerant alias map: actual header -> canonical field
      const aliasToField: Record<string, string> = {};
      headers.forEach((h) => {
        const n = norm(h);
        if (!n) return;
        if (["first name", "firstname"].includes(n)) aliasToField[h] = "First Name";
        else if (["last name", "lastname"].includes(n)) aliasToField[h] = "Last Name";
        else if (["phone", "phone number", "phonenumber", "phone1"].includes(n)) aliasToField[h] = "Phone";
        else if (["email", "e-mail"].includes(n)) aliasToField[h] = "Email";
        else if (["state"].includes(n)) aliasToField[h] = "State";
        else if (["notes", "note"].includes(n)) aliasToField[h] = "Notes";
        else if (["age"].includes(n)) aliasToField[h] = "Age";
        else if (["beneficiary"].includes(n)) aliasToField[h] = "Beneficiary";
        else if (["coverage amount", "coverage"].includes(n)) aliasToField[h] = "Coverage Amount";
      });

      const folder = await Folder.findById(folderId);
      if (!folder) continue;

      // process data rows (start at row 2)
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const hasAny = row.some((c) => String(c ?? "").trim() !== "");
        if (!hasAny) continue;

        // build doc using the tolerant header mapping
        const doc: Record<string, any> = {};
        headers.forEach((actual, i) => {
          const field = aliasToField[actual];
          if (field) doc[field] = row[i] ?? "";
        });

        const firstName = String(doc["First Name"] ?? "").trim();
        const lastName = String(doc["Last Name"] ?? "").trim();
        const phoneRaw = String(doc["Phone"] ?? "");
        const emailRaw = String(doc["Email"] ?? "");

        const p10 = phoneLast10(phoneRaw);
        const e = emailLc(emailRaw);

        if (!p10 && !e) {
          skipped++;
          continue;
        }

        // dedupe: prefer phone, fall back to email; scope by user + folder
        const filter: any = {
          userEmail: user.email,
          folderId,
          $or: [
            ...(p10 ? [{ phoneLast10: p10 }, { normalizedPhone: p10 }] : []),
            ...(e ? [{ Email: e }, { email: e }] : []),
          ],
        };

        const setOnInsert: any = {
          createdAt: new Date(),
          userEmail: user.email,
          folderId,
          status: "New",
        };

        const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

        const set: any = {
          // identity mirrors used across the app
          Phone: phoneRaw,
          normalizedPhone: p10 || undefined,
          phoneLast10: p10 || undefined,
          Email: e || undefined,
          email: e || undefined,

          "First Name": firstName,
          "Last Name": lastName,
          name: fullName || undefined,
          Notes: doc["Notes"] ?? "",
          State: doc["State"] ?? "",
          Age: doc["Age"] ?? "",
          Beneficiary: doc["Beneficiary"] ?? "",
          "Coverage Amount": doc["Coverage Amount"] ?? "",
          updatedAt: new Date(),

          // provenance
          source: "google-sheets",
          sourceSpreadsheetId: spreadsheetId,
          sourceTabTitle: tabTitle,
          sourceRowIndex: r + 1,
        };

        // upsert
        const result = await (Lead as any).updateOne(
          filter,
          { $set: set, $setOnInsert: setOnInsert },
          { upsert: true }
        );

        const wasInsert =
          (result?.upsertedCount || 0) > 0 ||
          Boolean((result as any)?.upsertedId);
        if (wasInsert) {
          imported++;

          // kick off initial drip IF folder has a drip configured (keeps your prior behavior)
          try {
            if ((folder as any).assignedDrip) {
              const dripReadyLead = {
                ...setOnInsert,
                ...set,
                folderName: (folder as any).name,
                agentName: (folder as any).agentName || (user as any).name || "your agent",
                agentPhone: (folder as any).agentPhone || "",
              };
              await sendInitialDrip(dripReadyLead as any);
            }
          } catch (e) {
            // do not throw; keep loop robust
            console.warn("sendInitialDrip failed:", (e as any)?.message || e);
          }
        } else {
          updated++;
        }
      }
    }
  }

  return res.status(200).json({
    message: "Google Sheets polling complete",
    imported,
    updated,
    skipped,
  });
}

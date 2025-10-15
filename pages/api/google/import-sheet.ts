// /pages/api/google/import-sheet.ts (legacy one-off import; NOW SAFE)
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { google } from "googleapis";
import mongoose from "mongoose";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

/* ---------- helpers ---------- */
const digits = (v: any) => String(v ?? "").replace(/\D+/g, "");
const last10 = (v: any) => {
  const d = digits(v);
  return d.slice(-10) || "";
};
const lcEmail = (v: any) => {
  const s = String(v ?? "").trim().toLowerCase();
  return s || "";
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const userEmail = session.user.email.toLowerCase();
    const user = await User.findOne({ email: userEmail }).lean<any>();
    if (!user?.googleSheets) {
      return res.status(400).json({ message: "Google not connected." });
    }

    // Accept either shape: googleSheets.syncedSheets OR googleSheets.sheets
    const syncedSheets =
      (user.googleSheets as any).syncedSheets ||
      (user.googleSheets as any).sheets ||
      [];
    if (!Array.isArray(syncedSheets) || !syncedSheets.length) {
      return res.status(400).json({ message: "No synced sheets found." });
    }

    const { sheetId } = req.body as { sheetId?: string };
    const sheetEntry = syncedSheets.find((s: any) => s.sheetId === sheetId || s.spreadsheetId === sheetId);
    if (!sheetEntry)
      return res.status(404).json({ message: "Sheet not found for user." });

    // Resolve a SAFE target folder for THIS user
    let folder: any = null;

    // Prefer an explicit, user-owned folderId and ensure it's not a system folder
    if (sheetEntry.folderId) {
      folder = await Folder.findOne({
        _id: new mongoose.Types.ObjectId(String(sheetEntry.folderId)),
        userEmail,
      }).lean();
      if (folder && isSystemFolder(folder.name)) {
        return res.status(400).json({ message: `Cannot import into system folder "${folder.name}".` });
      }
    }

    // Fallback: create/find by name saved on link (never system names)
    if (!folder) {
      const fallbackName =
        (sheetEntry.folderName as string) ||
        `${(sheetEntry.title || "Imported Leads").toString()}`;
      if (isSystemFolder(fallbackName)) {
        return res.status(400).json({ message: `Cannot import into system folder "${fallbackName}".` });
      }
      folder = await Folder.findOneAndUpdate(
        { userEmail, name: fallbackName },
        { $setOnInsert: { userEmail, name: fallbackName, source: "google-sheets" } },
        { new: true, upsert: true }
      ).lean();
    }

    // OAuth
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token:
        (user as any).googleTokens?.accessToken ||
        (user as any).googleSheets?.accessToken ||
        undefined,
      refresh_token:
        (user as any).googleTokens?.refreshToken ||
        (user as any).googleSheets?.refreshToken ||
        undefined,
    });

    const sheets = google.sheets({ version: "v4", auth: oauth2Client });
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetEntry.spreadsheetId || sheetId!,
      range: (sheetEntry.title && `'${sheetEntry.title}'!A1:ZZ`) || "Sheet1",
      majorDimension: "ROWS",
    });

    const rows = response.data.values || [];
    if (rows.length < 2) {
      return res.status(200).json({ message: "Sheet is empty or missing header row.", inserted: 0, updated: 0 });
    }

    const headers = rows[0].map((h) => String(h || "").trim().toLowerCase());
    const data = rows.slice(1);

    // Smart column detection (same behavior as before)
    const findCol = (alts: string[]) => headers.findIndex((h) => alts.includes(h));
    const nameCol = findCol(["name", "fullname", "clientname"]);
    const phoneCol = findCol(["phone", "phonenumber", "cell", "mobile"]);
    const emailCol = findCol(["email", "emailaddress"]);
    const zipCol = findCol(["zip", "zipcode", "postalcode"]);
    const cityCol = findCol(["city", "town"]);
    const stateCol = findCol(["state", "province"]);

    let inserted = 0;
    let updated = 0;

    for (const row of data) {
      const name = nameCol !== -1 ? row[nameCol] || "" : "";
      const phoneRaw = phoneCol !== -1 ? row[phoneCol] || "" : "";
      const emailRaw = emailCol !== -1 ? row[emailCol] || "" : "";

      const p10 = last10(phoneRaw);
      const em = lcEmail(emailRaw);

      // Must have at least one identity key
      if (!p10 && !em) continue;

      // 🔑 Dedupe ACROSS THE USER (not by folder) so we can MOVE out of Sold
      const or: any[] = [];
      if (p10) or.push({ phoneLast10: p10 }, { normalizedPhone: p10 });
      if (em) or.push({ Email: em }, { email: em });

      const filter: any = { userEmail, ...(or.length ? { $or: or } : {}) };

      const setOnInsert: any = { createdAt: new Date(), status: "New" };
      const set: any = {
        userEmail,
        ownerEmail: userEmail,
        folderId: folder._id,                 // ✅ always set target folder
        folder_name: String(folder.name),
        "Folder Name": String(folder.name),
        updatedAt: new Date(),
        // identity mirrors
        Phone: phoneRaw,
        phoneLast10: p10 || undefined,
        normalizedPhone: p10 || undefined,
        Email: em || undefined,
        email: em || undefined,
        // optional fields
        name,
        zip: zipCol !== -1 ? row[zipCol] || "" : "",
        city: cityCol !== -1 ? row[cityCol] || "" : "",
        state: stateCol !== -1 ? row[stateCol] || "" : "",
        source: "google-sheets",
      };

      const r = await (Lead as any).updateOne(filter, { $set: set, $setOnInsert: setOnInsert }, { upsert: true });
      const upc = r?.upsertedCount || (r?.upsertedId ? 1 : 0) || 0;
      const mod = r?.modifiedCount || 0;
      const match = r?.matchedCount || 0;

      if (upc > 0) inserted += upc;
      else if (mod > 0 || match > 0) updated += 1;
    }

    return res.status(200).json({ message: `${inserted} inserted, ${updated} updated.`, inserted, updated, folderId: String(folder._id), folderName: folder.name });
  } catch (err) {
    console.error("Google sheet import error (legacy fixed):", err);
    return res.status(500).json({ message: "Internal server error." });
  }
}

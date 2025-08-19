// /pages/api/google/import-sheet.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import { google } from "googleapis";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email)
    return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user?.googleSheets) {
      return res.status(400).json({ message: "Google not connected." });
    }

    // ✅ Support both shapes: googleSheets.syncedSheets OR googleSheets.sheets
    const syncedSheets =
      (user.googleSheets as any).syncedSheets ||
      (user.googleSheets as any).sheets ||
      [];
    if (!Array.isArray(syncedSheets) || !syncedSheets.length) {
      return res.status(400).json({ message: "No synced sheets found." });
    }

    const { sheetId } = req.body as { sheetId?: string };
    const sheetEntry = syncedSheets.find((s: any) => s.sheetId === sheetId);
    if (!sheetEntry)
      return res.status(404).json({ message: "Sheet not found for user." });

    const { folderId } = sheetEntry;
    const folder = await Folder.findById(folderId);
    if (!folder) return res.status(404).json({ message: "Folder not found." });

    // Load Google OAuth credentials from user (prefer tokens we store)
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
      spreadsheetId: sheetId!,
      range: "Sheet1",
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      return res
        .status(400)
        .json({ message: "Sheet is empty or missing header row." });
    }

    const headers = rows[0].map((h) =>
      String(h || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
    );
    const dataRows = rows.slice(1);

    // Smart column detection
    const matchColumn = (target: string[]) => {
      return headers.findIndex((header) => target.includes(header));
    };

    const nameCol = matchColumn(["name", "fullname", "clientname"]);
    const phoneCol = matchColumn(["phone", "phonenumber", "cell", "mobile"]);
    const emailCol = matchColumn(["email", "emailaddress"]);
    const zipCol = matchColumn(["zip", "zipcode", "postalcode"]);
    const cityCol = matchColumn(["city", "town"]);
    const stateCol = matchColumn(["state", "province"]);

    let inserted = 0;
    for (const row of dataRows) {
      const name = nameCol !== -1 ? row[nameCol] || "" : "";
      const phone = phoneCol !== -1 ? row[phoneCol] || "" : "";
      const email = emailCol !== -1 ? row[emailCol] || "" : "";

      if (!phone && !email) continue;

      // Avoid duplicate import (based on phone or email in same folder)
      const existing = await Lead.findOne({
        folderId,
        $or: [{ phone }, { email }],
      }).lean();
      if (existing) continue;

      await Lead.create({
        name,
        phone,
        email,
        zip: zipCol !== -1 ? row[zipCol] || "" : "",
        city: cityCol !== -1 ? row[cityCol] || "" : "",
        state: stateCol !== -1 ? row[stateCol] || "" : "",
        folderId,
        userEmail: session.user.email,
        leadType: String(folder.name || "").toLowerCase(),
        interactionHistory: [],
        callTranscripts: [],
        remindersSent: [],
      });

      inserted++;
    }

    return res
      .status(200)
      .json({ message: `${inserted} leads imported successfully.` });
  } catch (err) {
    console.error("Google sheet import error:", err);
    return res.status(500).json({ message: "Internal server error." });
  }
}

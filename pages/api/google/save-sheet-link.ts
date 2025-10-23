// /pages/api/google/save-sheet-link.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { google } from "googleapis";
import { ensureSafeFolder } from "@/lib/ensureSafeFolder";

type Body = {
  spreadsheetId: string;      // REQUIRED
  title: string;               // REQUIRED (tab title)
  sheetId?: number;
  folderId?: string;
  folderName?: string;
  headerRow?: number;
  mapping?: Record<string, string>;
  skip?: Record<string, boolean>;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    await dbConnect();
    const user = await User.findOne({ email: userEmail }).lean();
    const gs: any = (user as any)?.googleSheets || {};
    return res.status(200).json({ sheets: gs.syncedSheets || [] });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const {
    spreadsheetId,
    title,
    sheetId,
    folderId,
    folderName,
    headerRow = 1,
    mapping = {},
    skip = {},
  } = (req.body || {}) as Body;

  if (!spreadsheetId || !title) {
    return res.status(400).json({ message: "Missing spreadsheetId or title" });
  }

  try {
    await dbConnect();

    // Load user + tokens (googleSheets or legacy googleTokens)
    const user = await User.findOne({ email: userEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    const gs: any = (user as any).googleSheets || {};
    const legacy: any = (user as any).googleTokens || {};
    const tok = gs?.refreshToken ? gs : legacy?.refreshToken ? legacy : null;
    if (!tok?.refreshToken) return res.status(400).json({ message: "Google not connected" });

    // OAuth client (for Drive meta only)
    const base = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_BASE_URL || "";
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID!,
      process.env.GOOGLE_CLIENT_SECRET!,
      `${base}/api/connect/google-sheets/callback`
    );
    oauth2.setCredentials({
      access_token: tok.accessToken,
      refresh_token: tok.refreshToken,
      expiry_date: tok.expiryDate,
    });

    // Drive meta for default name
    const drive = google.drive({ version: "v3", auth: oauth2 });
    const meta = await drive.files.get({ fileId: spreadsheetId, fields: "name" });
    const defaultName = `${meta.data.name || "Imported Leads"} — ${title}`.trim();

    // Sanitize/resolve destination folder
    const folderDoc = await ensureSafeFolder({
      userEmail,
      folderId,
      folderName,
      defaultName,
      source: "google-sheets",
    });

    // ✅ Persist (or upsert) into googleSheets.syncedSheets WITH refreshToken
    //    We match by spreadsheetId + title to preserve your existing behavior.
    const finder = {
      email: userEmail,
      "googleSheets.syncedSheets.spreadsheetId": spreadsheetId,
      "googleSheets.syncedSheets.title": title,
    };

    const update = {
      $set: {
        "googleSheets.syncedSheets.$.folderId": folderDoc._id,
        "googleSheets.syncedSheets.$.folderName": folderDoc.name,
        "googleSheets.syncedSheets.$.headerRow": headerRow,
        "googleSheets.syncedSheets.$.mapping": mapping,
        "googleSheets.syncedSheets.$.skip": skip,
        "googleSheets.syncedSheets.$.refreshToken": tok.refreshToken, // ✅ ensure refresh token is on the entry
        ...(typeof sheetId === "number" ? { "googleSheets.syncedSheets.$.sheetId": sheetId } : {}),
      },
    };

    const result = await User.updateOne(finder, update);

    if (result.matchedCount === 0) {
      // First time linking this sheet/tab — push a brand-new entry
      await User.updateOne(
        { email: userEmail },
        {
          $push: {
            "googleSheets.syncedSheets": {
              spreadsheetId,
              title,
              ...(typeof sheetId === "number" ? { sheetId } : {}),
              headerRow,
              mapping,
              skip,
              folderId: folderDoc._id,
              folderName: folderDoc.name,
              lastRowImported: headerRow, // start pointer at headerRow
              refreshToken: tok.refreshToken, // ✅ make poller-ready on day one
            },
          },
        }
      );
    } else {
      // If we updated an existing entry but it somehow lacked a refreshToken, ensure it's set.
      await User.updateOne(
        { email: userEmail, "googleSheets.syncedSheets.spreadsheetId": spreadsheetId, "googleSheets.syncedSheets.title": title, "googleSheets.syncedSheets.refreshToken": { $in: [null, ""] } },
        { $set: { "googleSheets.syncedSheets.$.refreshToken": tok.refreshToken } }
      );
    }

    return res.status(200).json({
      ok: true,
      spreadsheetId,
      title,
      sheetId,
      folderId: String(folderDoc._id),
      folderName: folderDoc.name,
    });
  } catch (err: any) {
    console.error("save-sheet-link error:", err);
    return res.status(500).json({ message: err?.message || "Internal server error" });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ message: "User not found" });

  // ========== GET: Return all synced sheets for UI/debug ==========
  if (req.method === "GET") {
    const gs: any = (user as any).googleSheets || {};
    const sheets: any[] = gs.syncedSheets || gs.sheets || [];
    return res.status(200).json({ sheets });
  }

  // ========== POST: Save/update a sheet-to-folder link ==========
  if (req.method === "POST") {
    const { sheetId, sheetName, folderId } = req.body as {
      sheetId?: string;   // <- this is the Google "spreadsheetId" (string)
      sheetName?: string; // <- tab title
      folderId?: string;
    };

    if (!sheetId || !sheetName || !folderId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    try {
      // Ensure googleSheets container exists
      let gs: any = (user as any).googleSheets;
      if (!gs) {
        gs = {
          accessToken:
            (user as any).googleTokens?.accessToken ||
            (user as any).googleSheets?.accessToken ||
            "",
          refreshToken:
            (user as any).googleTokens?.refreshToken ||
            (user as any).googleSheets?.refreshToken ||
            "",
          expiryDate:
            (user as any).googleTokens?.expiryDate ||
            (user as any).googleSheets?.expiryDate ||
            0,
          googleEmail:
            (user as any).googleTokens?.googleEmail ||
            (user as any).googleSheets?.googleEmail ||
            session.user.email,
          sheets: [],
          syncedSheets: [],
        };
        (user as any).googleSheets = gs;
      }

      // Normalize to a single array and keep both properties in sync
      const arr: any[] = Array.isArray(gs.syncedSheets)
        ? gs.syncedSheets
        : Array.isArray(gs.sheets)
        ? gs.sheets
        : [];
      gs.syncedSheets = arr;
      gs.sheets = arr;

      // Store the fields the poller expects:
      // - spreadsheetId (string)
      // - title (tab title)
      // Also keep legacy keys for back-compat: sheetId (string), sheetName
      const payload = {
        spreadsheetId: sheetId,  // <- REQUIRED by /api/cron/google-sheets-poll
        title: sheetName,        // <- REQUIRED by /api/cron/google-sheets-poll (if no numeric gid)
        folderId,
        folderName: undefined,   // filled later once resolved, optional
        // legacy/compat fields:
        sheetId,                 // (string) spreadsheetId
        sheetName,               // tab title
      };

      const idx = arr.findIndex(
        (s: any) =>
          s.spreadsheetId === sheetId ||
          s.sheetId === sheetId // back-compat match
      );

      if (idx !== -1) {
        arr[idx] = { ...arr[idx], ...payload };
      } else {
        arr.push(payload);
      }

      await user.save();
      return res.status(200).json({ message: "Sheet linked successfully" });
    } catch (err) {
      console.error("Save sheet link error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // ========== Fallback ==========
  return res.status(405).json({ message: "Method not allowed" });
}

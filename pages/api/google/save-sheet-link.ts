import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { ensureSafeFolder } from "@/lib/ensureSafeFolder";

/**
 * Saves/updates a Google Sheet ↔ folder link for the current user.
 * - Sanitizes folder resolution via ensureSafeFolder (never system folders).
 * - Writes ONLY to googleSheets.syncedSheets (no legacy mirroring).
 * - Backwards compatible request body:
 *     Preferred: { spreadsheetId, title, folderId?, folderName? }
 *     Legacy:    { sheetId, sheetName, folderId?, folderName? }
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const userEmail = session.user.email.toLowerCase();

  await dbConnect();
  const user = await User.findOne({ email: userEmail });
  if (!user) return res.status(404).json({ message: "User not found" });

  // ---------- GET: Return synced sheets (UI/debug) ----------
  if (req.method === "GET") {
    const gs: any = (user as any).googleSheets || {};
    const sheets: any[] = Array.isArray(gs?.syncedSheets) ? gs.syncedSheets : [];
    return res.status(200).json({ sheets });
  }

  // ---------- POST: Save/update a sheet-to-folder link ----------
  if (req.method === "POST") {
    // Accept both current and legacy names from clients.
    const {
      spreadsheetId,
      title,
      folderId: rawFolderId,
      folderName: rawFolderName,

      // legacy fallbacks:
      sheetId,
      sheetName,
    } = req.body as {
      spreadsheetId?: string;
      title?: string;
      folderId?: string;
      folderName?: string;
      sheetId?: string;   // legacy
      sheetName?: string; // legacy
    };

    // Validate presence of identifiers (prefer spreadsheetId+title, else legacy sheetId).
    const hasCanonical = Boolean(spreadsheetId && title);
    const hasLegacy = Boolean(sheetId && sheetName);
    if (!hasCanonical && !hasLegacy) {
      return res.status(400).json({ message: "Missing required fields (need spreadsheetId+title or sheetId+sheetName)" });
    }

    try {
      // Normalize the record shape we store in syncedSheets.
      const normalized = hasCanonical
        ? {
            spreadsheetId: String(spreadsheetId),
            title: String(title),
            // default/fallback name for ensureSafeFolder (no Drive call here):
            defaultName: `${String(spreadsheetId)} — ${String(title)}`, // unique-ish, replaced by actual safe folder name
            keyPredicate: (s: any) => s.spreadsheetId === String(spreadsheetId) && s.title === String(title),
            upsertBase: { spreadsheetId: String(spreadsheetId), title: String(title) },
          }
        : {
            // Legacy mode: keep the sheetId/sheetName so old clients still work.
            sheetId: String(sheetId),
            sheetName: String(sheetName),
            defaultName: `${String(sheetName)} — ${String(sheetId)}`,
            keyPredicate: (s: any) => s.sheetId === String(sheetId),
            upsertBase: { sheetId: String(sheetId), sheetName: String(sheetName) },
          };

      // Guarantee a non-system folder. If UI sent a system value, it will be coerced.
      const safeFolder = await ensureSafeFolder({
        userEmail,
        folderId: rawFolderId,
        folderName: rawFolderName,
        defaultName: normalized.defaultName,
        source: "google-sheets",
      });

      // Ensure googleSheets structure exists.
      const gs: any = (user as any).googleSheets ?? {};
      if (!(user as any).googleSheets) {
        (user as any).googleSheets = gs;
      }

      // Use ONLY syncedSheets (no mirroring to .sheets).
      if (!Array.isArray(gs.syncedSheets)) gs.syncedSheets = [];

      const arr: any[] = gs.syncedSheets;
      const idx = arr.findIndex(normalized.keyPredicate);

      const nextLink = {
        ...normalized.upsertBase,
        folderId: String(safeFolder._id),
        folderName: String(safeFolder.name),
      };

      if (idx !== -1) {
        arr[idx] = { ...arr[idx], ...nextLink };
      } else {
        arr.push(nextLink);
      }

      await user.save();

      return res.status(200).json({
        message: "Sheet linked successfully",
        sheet: nextLink,
      });
    } catch (err) {
      console.error("save-sheet-link error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  return res.status(405).json({ message: "Method not allowed" });
}

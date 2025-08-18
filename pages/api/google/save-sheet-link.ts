import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ message: "User not found" });

  // ========== GET: Return all synced sheets for UI/debug ==========
  if (req.method === "GET") {
    const sheets = user.googleSheets?.syncedSheets || [];
    return res.status(200).json({ sheets });
  }

  // ========== POST: Save/update a sheet-to-folder link ==========
  if (req.method === "POST") {
    const { sheetId, sheetName, folderId } = req.body;

    if (!sheetId || !sheetName || !folderId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    try {
      user.googleSheets = user.googleSheets || {};
      user.googleSheets.syncedSheets = user.googleSheets.syncedSheets || [];

      const existingIndex = user.googleSheets.syncedSheets.findIndex(
        (s: any) => s.sheetId === sheetId,
      );

      const newSheetLink = { sheetId, sheetName, folderId };

      if (existingIndex !== -1) {
        // Update existing sheet config
        user.googleSheets.syncedSheets[existingIndex] = newSheetLink;
      } else {
        // Add new sheet config
        user.googleSheets.syncedSheets.push(newSheetLink);
      }

      await user.save();
      return res.status(200).json({ message: "Sheet linked successfully" });
    } catch (err) {
      console.error("Save sheet link error:", err);
      return res.status(500).json({ message: "Internal server error" });
    }
  }

  // ========== Fallback for unsupported methods ==========
  return res.status(405).json({ message: "Method not allowed" });
}

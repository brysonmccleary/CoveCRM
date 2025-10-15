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
    const gs: any = (user as any).googleSheets || {};
    const sheets: any[] = gs.syncedSheets || gs.sheets || [];
    return res.status(200).json({ sheets });
  }

  // ========== POST: Save/update a sheet-to-folder link ==========
  if (req.method === "POST") {
    const { sheetId, sheetName, folderId } = req.body as {
      sheetId?: string;
      sheetName?: string;
      folderId?: string;
    };

    if (!sheetId || !sheetName || !folderId) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    try {
      // Ensure googleSheets object exists and satisfies required fields for TS
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
        };
        (user as any).googleSheets = gs;
      }

      // Normalize array shape: support both .syncedSheets and .sheets
      const arr: any[] = Array.isArray(gs.syncedSheets)
        ? gs.syncedSheets
        : Array.isArray(gs.sheets)
          ? gs.sheets
          : [];
      gs.syncedSheets = arr;

      const idx = arr.findIndex((s: any) => s.sheetId === sheetId);
      const newSheetLink = { sheetId, sheetName, folderId };

      if (idx !== -1) {
        arr[idx] = newSheetLink;
      } else {
        arr.push(newSheetLink);
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

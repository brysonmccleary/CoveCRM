// /pages/api/sheets/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import { isSystemFolderName as isSystemFolder } from "@/lib/systemFolders";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { sheetId, folderName, tabName } = (req.body || {}) as {
    sheetId?: string; folderName?: string; tabName?: string;
  };
  if (!sheetId || !folderName) return res.status(400).json({ error: "Missing sheetId or folderName" });
  if (isSystemFolder(folderName)) return res.status(400).json({ error: "Cannot link a sheet to a system folder" });

  try {
    await dbConnect();
    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const gs: any = (user as any).googleSheets || {};
    gs.syncedSheets = Array.isArray(gs.syncedSheets) ? gs.syncedSheets : [];
    const idx = gs.syncedSheets.findIndex((s: any) => s.sheetId === sheetId);

    const entry = { sheetId, folderName, tabName: tabName || "", lastSyncedAt: null };
    if (idx >= 0) gs.syncedSheets[idx] = entry; else gs.syncedSheets.push(entry);
    (user as any).googleSheets = gs;

    await user.save();
    return res.status(200).json({ ok: true });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "Failed" });
  }
}

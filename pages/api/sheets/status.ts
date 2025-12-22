// /pages/api/sheets/status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const gs: any = (user as any).googleSheets || {};
  const syncedSheets = Array.isArray(gs.syncedSheets) ? gs.syncedSheets : [];

  return res.status(200).json({
    ok: true,
    syncedSheets: syncedSheets.map((s: any) => ({
      sheetId: s.sheetId,
      folderName: s.folderName,
      tabName: s.tabName || "",
      gid: s.gid || "",
      lastSyncedAt: s.lastSyncedAt || null,
      lastEventAt: s.lastEventAt || null,
    })),
  });
}

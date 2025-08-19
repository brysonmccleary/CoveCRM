// /pages/api/sheets/connect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const { sheetId, folderName, tabName } = req.body || {};
  if (!sheetId || !folderName) {
    return res.status(400).json({ error: "Missing sheetId or folderName" });
  }

  await dbConnect();
  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  const gs = (user as any).googleSheets || {};
  const list = Array.isArray(gs.sheets) ? gs.sheets : [];

  // Upsert this connection
  const idx = list.findIndex((s: any) => s.sheetId === sheetId);
  const entry = { sheetId, folderName, tabName: tabName || "", lastSyncedAt: null };
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);

  (user as any).googleSheets = { ...gs, sheets: list };
  await user.save();

  res.status(200).json({ ok: true });
}

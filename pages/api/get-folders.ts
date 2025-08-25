// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

type AnyDoc = Record<string, any>;
const SYSTEM_DEFAULTS = ["Sold", "Not Interested", "Booked Appointment"];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // Ensure system folders exist for THIS email
    for (const name of SYSTEM_DEFAULTS) {
      await Folder.updateOne(
        { userEmail: email, name },
        { $setOnInsert: { userEmail: email, name, assignedDrips: [] } },
        { upsert: true }
      );
    }

    // Only this user's folders
    const raw: AnyDoc[] = await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    // De-dupe by name (case-insensitive) to avoid doubles
    const byName = new Map<string, AnyDoc>();
    for (const f of raw) {
      const key = String(f?.name || "").trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, f);
    }
    const folders: AnyDoc[] = Array.from(byName.values());

    // **Bulletproof counts**: count per folderId (no aggregation surprises)
    const counts = new Map<string, number>();
    for (const f of folders) {
      const idStr = String(f._id);
      const n = await Lead.countDocuments({
        $or: [{ userEmail: email }, { user: email }], // support legacy "user"
        folderId: f._id, // ***STRICT: must match this folder _id***
      }).exec();
      counts.set(idStr, n);
    }

    // Sort: custom/imported first, system after (newest first within each bucket)
    folders.sort((a, b) => {
      const aSys = SYSTEM_DEFAULTS.includes(String(a.name));
      const bSys = SYSTEM_DEFAULTS.includes(String(b.name));
      if (aSys !== bSys) return aSys ? 1 : -1;
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    const result = folders.map((f) => ({
      _id: String(f._id),
      name: String(f.name || ""),
      userEmail: String(f.userEmail || email),
      assignedDrips: Array.isArray(f.assignedDrips) ? f.assignedDrips : [],
      leadCount: counts.get(String(f._id)) || 0,
    }));

    return res.status(200).json({ folders: result });
  } catch (err) {
    console.error("❌ get-folders error:", err);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

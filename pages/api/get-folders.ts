// /pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

type LeanFolder = {
  _id: any;
  name: string;
  userEmail: string;
  assignedDrips?: any[];
  createdAt?: Date;
  updatedAt?: Date;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Idempotently ensure each system folder exists for this user.
 * Uses case-insensitive EXACT match to avoid dupes with different casing.
 * If found, returns the existing doc; otherwise creates it with canonical casing.
 */
async function ensureSystemFolder(userEmail: string, name: string): Promise<LeanFolder> {
  const rx = new RegExp(`^${escapeRegex(name)}$`, "i");
  const found = await Folder.findOne({ userEmail, name: rx }).lean<LeanFolder | null>();
  if (found) return found;
  const created = await Folder.create({ userEmail, name, assignedDrips: [] });
  return { _id: created._id, name, userEmail };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Ensure system folders exist (no dupes, case-insensitive)
    const ensuredSystem = await Promise.all(SYSTEM_FOLDERS.map((n) => ensureSystemFolder(email, n)));
    const systemIds = new Set(ensuredSystem.map((f) => String(f._id)));
    const systemLower = new Set(SYSTEM_FOLDERS.map((n) => n.toLowerCase()));

    // 2) Fetch all user folders (may include historical dupes)
    const all = (await Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean()) as LeanFolder[];

    // 3) Coalesce: keep custom folders; for system names keep the ensured ones
    const custom: LeanFolder[] = all.filter(
      (f) => !systemIds.has(String(f._id)) && !systemLower.has(String(f.name || "").toLowerCase())
    );
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // Final ordered list: custom first, then system in canonical order
    const ordered: LeanFolder[] = [
      ...custom,
      ...SYSTEM_FOLDERS.map((n) => ensuredSystem.find((f) => f && f.name.toLowerCase() === n.toLowerCase())!).filter(Boolean),
    ];

    // 4) Counts by folderId (strict by actual folderId only)
    const byIdAgg = await Lead.aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), r.n as number);

    // 5) Optional: Unsorted support (do NOT create it; only count if the user has one)
    const unsorted = all
      .filter((f) => String(f.name || "").toLowerCase() === "unsorted")
      .sort((a, b) => {
        const ad = new Date(a.createdAt || 0).getTime();
        const bd = new Date(b.createdAt || 0).getTime();
        return ad - bd || String(a._id).localeCompare(String(b._id));
      })[0];
    const unsortedIdStr = unsorted ? String(unsorted._id) : null;

    const unsortedCount = await Lead.countDocuments({
      userEmail: email,
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    // 6) Attach counts and stringify _id for the client
    const foldersWithCounts = ordered.map((f) => {
      const idStr = String(f._id);
      const count = (byId.get(idStr) || 0) + (unsortedIdStr && idStr === unsortedIdStr ? unsortedCount : 0);
      return { ...f, _id: idStr, leadCount: count };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

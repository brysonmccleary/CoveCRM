// /pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const SYSTEM_FOLDERS = ["Not Interested", "Booked Appointment", "Sold"];

type LeanFolder = {
  _id: string;
  name: string;
  userEmail: string;
  assignedDrips?: any[];
  createdAt?: Date;
  updatedAt?: Date;
};

// Raw shape coming back from mongoose .lean()
type DBFolderLean = {
  _id: any;
  name?: string;
  userEmail?: string;
  assignedDrips?: any[];
  createdAt?: any;
  updatedAt?: any;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Idempotently ensure a system folder exists for a user.
 * Case-insensitive EXACT match to avoid dupes. Returns a LeanFolder.
 */
async function ensureSystemFolder(userEmail: string, name: string): Promise<LeanFolder> {
  const rx = new RegExp(`^${escapeRegex(name)}$`, "i");
  const found = await Folder.findOne({ userEmail, name: rx }).lean<DBFolderLean>().exec();
  if (found) {
    return {
      _id: String(found._id),
      name: String(found.name ?? name),
      userEmail: String(found.userEmail ?? userEmail),
      assignedDrips: found.assignedDrips ?? [],
      createdAt: found.createdAt ? new Date(found.createdAt) : undefined,
      updatedAt: found.updatedAt ? new Date(found.updatedAt) : undefined,
    };
  }
  const created = await Folder.create({ userEmail, name, assignedDrips: [] });
  return {
    _id: String(created._id),
    name,
    userEmail,
    assignedDrips: [],
    createdAt: created.createdAt ? new Date(created.createdAt) : undefined,
    updatedAt: created.updatedAt ? new Date(created.updatedAt) : undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Ensure system folders exist (no dupes, case-insensitive)
    const ensuredSystem = await Promise.all(SYSTEM_FOLDERS.map((n) => ensureSystemFolder(email, n)));
    const systemByLower = new Map(ensuredSystem.map((f) => [f.name.toLowerCase(), f]));

    // 2) Fetch all user folders (lean), then map explicitly to LeanFolder
    const allRaw = await Folder.find({ userEmail: email }).sort({ createdAt: -1 }).lean<DBFolderLean[]>().exec();
    const all: LeanFolder[] = (allRaw || []).map((f) => ({
      _id: String(f._id),
      name: String(f.name ?? ""),
      userEmail: String(f.userEmail ?? email),
      assignedDrips: f.assignedDrips ?? [],
      createdAt: f.createdAt ? new Date(f.createdAt) : undefined,
      updatedAt: f.updatedAt ? new Date(f.updatedAt) : undefined,
    }));

    // 3) Split custom vs system (by name, case-insensitive). Keep only one canonical system instance.
    const systemLower = new Set(SYSTEM_FOLDERS.map((n) => n.toLowerCase()));
    const custom = all.filter((f) => !systemLower.has(f.name.toLowerCase()));
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // Final ordered list: custom first, then system in canonical order
    const ordered: LeanFolder[] = [
      ...custom,
      ...SYSTEM_FOLDERS.map((n) => systemByLower.get(n.toLowerCase())!).filter(Boolean) as LeanFolder[],
    ];

    // 4) Counts by actual folderId (strict)
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // 5) Optional: Unsorted support (we do NOT create it; only count if the user has one)
    const unsorted = all
      .filter((f) => f.name.toLowerCase() === "unsorted")
      .sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      })[0];
    const unsortedIdStr = unsorted ? String(unsorted._id) : null;

    const unsortedCount = await Lead.countDocuments({
      userEmail: email,
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    // 6) Attach counts and return
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

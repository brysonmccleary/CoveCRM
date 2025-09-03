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

/** Map raw mongo docs to our LeanFolder shape */
function toLeanFolder(doc: DBFolderLean, fallbackEmail: string): LeanFolder {
  return {
    _id: String(doc._id),
    name: String(doc.name ?? ""),
    userEmail: String(doc.userEmail ?? fallbackEmail),
    assignedDrips: doc.assignedDrips ?? [],
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // --- 1) Atomically ensure system folders exist (case-insensitive, no dupes)
    const ops = SYSTEM_FOLDERS.map((name) => ({
      updateOne: {
        filter: {
          userEmail: email,
          name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
        },
        update: { $setOnInsert: { userEmail: email, name, assignedDrips: [] } },
        upsert: true,
        collation: { locale: "en", strength: 2 }, // case-insensitive
      },
    }));
    await (Folder as any).bulkWrite(ops, { ordered: false });

    // --- 2) Fetch all folders for this user and normalize
    const allRaw = await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean<DBFolderLean[]>()
      .exec();
    const all: LeanFolder[] = (allRaw || []).map((f) => toLeanFolder(f, email));

    // --- 3) Partition custom vs. system (case-insensitive); pick canonical system docs
    const systemLower = new Set(SYSTEM_FOLDERS.map((n) => n.toLowerCase()));
    const custom = all.filter((f) => !systemLower.has(f.name.toLowerCase()));
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // For each system name, pick the earliest-created matching doc (stable & dupe-safe)
    const systemByLower: Map<string, LeanFolder> = new Map();
    for (const sysName of SYSTEM_FOLDERS) {
      const matches = all
        .filter((f) => f.name.toLowerCase() === sysName.toLowerCase())
        .sort((a, b) => {
          const ad = a.createdAt?.getTime() ?? 0;
          const bd = b.createdAt?.getTime() ?? 0;
          return ad - bd || a._id.localeCompare(b._id);
        });
      if (matches[0]) systemByLower.set(sysName.toLowerCase(), matches[0]);
    }

    // Final ordered list: custom first, then canonical system in fixed order
    const ordered: LeanFolder[] = [
      ...custom,
      ...SYSTEM_FOLDERS.map((n) => systemByLower.get(n.toLowerCase())!).filter(Boolean) as LeanFolder[],
    ];

    // --- 4) Counts by folderId (strict)
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // --- 5) Legacy "Unsorted": include count of leads without a folderId if such a folder exists
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

    // --- 6) Attach counts and return
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

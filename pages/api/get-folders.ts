// /pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

const SYSTEM_FOLDERS = ["Sold", "Not Interested", "Booked Appointment"] as const;

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

// normalize for comparisons (handle NBSP, trim/collapse spaces, lowercase)
function norm(s: any) {
  return String(s ?? "")
    .replace(/\u00A0/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

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
  // Never cache during troubleshooting
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "sys-v5"); // marker to verify the live code path

  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Ensure + canonicalize + dedupe system folders (case/space-insensitive)
    //    Keep the earliest, rename to canonical, delete any later variants.
    for (const canonical of SYSTEM_FOLDERS) {
      const rx = new RegExp(`^\\s*${escapeRegex(canonical)}\\s*$`, "i");
      const matches = await Folder.find({ userEmail: email, name: rx })
        .sort({ createdAt: 1, _id: 1 })
        .lean<DBFolderLean[]>()
        .exec();

      if (!matches.length) {
        // Create the canonical one if none exist
        await Folder.create({ userEmail: email, name: canonical, assignedDrips: [] });
        continue;
      }

      // Keep earliest
      const keep = matches[0];
      if (String(keep.name) !== canonical) {
        await Folder.updateOne({ _id: keep._id }, { $set: { name: canonical } }).exec();
      }

      // Delete all later duplicates
      const deleteIds = matches.slice(1).map((m) => m._id);
      if (deleteIds.length) {
        await Folder.deleteMany({ _id: { $in: deleteIds } }).exec();
      }
    }

    // 2) Fetch all folders and normalize to LeanFolder
    const allRaw = await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean<DBFolderLean[]>()
      .exec();
    const all: LeanFolder[] = (allRaw || []).map((f) => toLeanFolder(f, email));

    // 3) Partition custom vs system; stable order (custom A→Z, then fixed system order)
    const systemLower = new Set(SYSTEM_FOLDERS.map((n) => norm(n)));
    const custom = all.filter((f) => !systemLower.has(norm(f.name)));
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // Choose the (now canonicalized) unique system entries by name
    const systemByName = new Map<string, LeanFolder>();
    for (const sysName of SYSTEM_FOLDERS) {
      const pick = all.find((f) => norm(f.name) === norm(sysName));
      if (pick) systemByName.set(sysName, pick);
    }

    const ordered: LeanFolder[] = [
      ...custom,
      ...SYSTEM_FOLDERS.map((n) => systemByName.get(n)!).filter(Boolean) as LeanFolder[],
    ];

    // 4) Counts by folderId (strict)
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // 5) Legacy "Unsorted" handling (do not create; include no-folder leads if it exists)
    const unsorted = all
      .filter((f) => norm(f.name) === norm("Unsorted"))
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
      const count =
        (byId.get(idStr) || 0) +
        (unsortedIdStr && idStr === unsortedIdStr ? unsortedCount : 0);
      return { ...f, _id: idStr, leadCount: count };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

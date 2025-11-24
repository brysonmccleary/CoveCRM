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

type DBFolder = {
  _id: any;
  name?: string;
  userEmail?: string;
  user?: string; // legacy field
  assignedDrips?: any[];
  createdAt?: any;
  updatedAt?: any;
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeName(s?: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}
function normKey(s?: string) {
  return normalizeName(s).toLowerCase();
}
function toLeanFolder(doc: DBFolder, email: string): LeanFolder {
  return {
    _id: String(doc._id),
    name: normalizeName(doc.name),
    userEmail: String(doc.userEmail ?? doc.user ?? email),
    assignedDrips: doc.assignedDrips ?? [],
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // prevent stale caches while we’re stabilizing
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "sys-final");

  try {
    const session = await getServerSession(req, res, authOptions as any);
    const email =
      typeof session?.user?.email === "string"
        ? session.user.email.toLowerCase()
        : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Ensure system folders exist for *this* user only
    for (const name of SYSTEM_FOLDERS) {
      await Folder.findOneAndUpdate(
        {
          // strictly scoped to this user
          $or: [
            { userEmail: email, name: { $regex: `^\\s*${escapeRegex(name)}\\s*$`, $options: "i" } },
            {
              user: email,
              userEmail: { $exists: false },
              name: { $regex: `^\\s*${escapeRegex(name)}\\s*$`, $options: "i" },
            },
          ],
        },
        {
          $setOnInsert: {
            userEmail: email,
            user: email,
            name,
            assignedDrips: [],
          },
        },
        { upsert: true, new: false, lean: true }
      ).exec();
    }

    // 2) Fetch folders *only* for this user
    const raw = await Folder.find({
      $or: [
        { userEmail: email },
        { user: email, userEmail: { $exists: false } }, // legacy docs
      ],
    })
      .sort({ createdAt: -1 })
      .lean<DBFolder[]>()
      .exec();

    const all = raw.map((r) => toLeanFolder(r, email));

    // 3) Partition: custom vs system (by trimmed, lower-case name)
    const systemKeys = new Set(SYSTEM_FOLDERS.map((n) => normKey(n)));
    const custom: LeanFolder[] = [];
    const systemBuckets = new Map<string, LeanFolder[]>();

    for (const f of all) {
      const key = normKey(f.name);
      if (systemKeys.has(key)) {
        const arr = systemBuckets.get(key) || [];
        arr.push(f);
        systemBuckets.set(key, arr);
      } else {
        custom.push(f);
      }
    }

    // alphabetical custom
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // For each system bucket, choose canonical (oldest)
    const canonicalByKey = new Map<string, LeanFolder>();
    for (const [key, arr] of systemBuckets) {
      arr.sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      });
      canonicalByKey.set(key, arr[0]);
    }

    // 4) Counts per folder for this user
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);

    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // Optional legacy "Unsorted" handling (only for THIS user)
    const unsorted = all
      .filter((f) => normKey(f.name) === "unsorted")
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

    // 5) Final list: custom first, then the 3 system folders in fixed order
    const systemOrdered = SYSTEM_FOLDERS.map((n) =>
      canonicalByKey.get(normKey(n))
    ).filter(Boolean) as LeanFolder[];

    const ordered = [...custom, ...systemOrdered];

    const foldersWithCounts = ordered.map((f) => {
      const idStr = String(f._id);
      const base = byId.get(idStr) || 0;
      const extra = unsortedIdStr && idStr === unsortedIdStr ? unsortedCount : 0;
      return { ...f, _id: idStr, leadCount: base + extra };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

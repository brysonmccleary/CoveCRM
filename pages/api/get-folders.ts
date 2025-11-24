// pages/api/get-folders.ts
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
  user?: string;
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

function toLeanFolder(doc: DBFolder, sessionEmail: string): LeanFolder {
  return {
    _id: String(doc._id),
    name: normalizeName(doc.name),
    // 🔒 Always treat the owner as the current session user
    userEmail: sessionEmail,
    assignedDrips: doc.assignedDrips ?? [],
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // prevent stale caches while we’re stabilizing
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "sys-v8");

  try {
    const session = await getServerSession(req, res, authOptions);
    const emailRaw = typeof session?.user?.email === "string" ? session.user.email : "";
    const email = emailRaw.toLowerCase();
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // -------- 1) Ensure system folders exist for THIS user --------
    for (const name of SYSTEM_FOLDERS) {
      await Folder.findOneAndUpdate(
        {
          userEmail: email,
          name: { $regex: `^\\s*${escapeRegex(name)}\\s*$`, $options: "i" },
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

    // -------- 2) Fetch folders for this user only (DB-level scoping) --------
    const raw = await Folder.find({
      $or: [{ userEmail: email }, { user: email }],
    })
      .sort({ createdAt: -1 })
      .lean<DBFolder[]>()
      .exec();

    // Map into LeanFolder rows, forcing owner = session user
    const all: LeanFolder[] = raw.map((r) => toLeanFolder(r, email));

    // If truly nothing, just return empty — no leakage to other users
    if (!all.length) {
      return res.status(200).json({ folders: [] });
    }

    // -------- 3) Partition: custom vs system (trimmed, case-insensitive) --------
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

    // Custom alphabetical
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // Canonical system doc per name (oldest by createdAt, then by _id)
    const canonicalByKey = new Map<string, LeanFolder>();
    for (const [key, arr] of systemBuckets) {
      arr.sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      });
      canonicalByKey.set(key, arr[0]);
    }

    // -------- 4) Counts per folderId (already scoped by userEmail) --------
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // -------- 5) Optional "Unsorted" handling --------
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

    // -------- 6) Build final ordered list: custom, then system --------
    const systemOrdered = SYSTEM_FOLDERS.map((n) => canonicalByKey.get(normKey(n))).filter(
      Boolean
    ) as LeanFolder[];

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

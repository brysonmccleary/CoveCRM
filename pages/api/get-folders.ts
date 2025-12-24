// pages/api/get-folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
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
    userEmail: String(doc.userEmail ?? email).toLowerCase(),
    assignedDrips: doc.assignedDrips ?? [],
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // prevent stale caches while we’re stabilizing
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "per-user-system-final");

  try {
    const session = (await getServerSession(
      req,
      res,
      authOptions as any,
    )) as any;

    const email =
      typeof session?.user?.email === "string"
        ? (session.user.email as string).toLowerCase()
        : "";

    if (!email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await mongooseConnect();

    // 1) Ensure system folders exist for *this* user only (by userEmail)
    for (const name of SYSTEM_FOLDERS) {
      await Folder.findOneAndUpdate(
        {
          userEmail: email,
          // case-insensitive match on the name so we don't create more dupes
          name: {
            $regex: `^\\s*${escapeRegex(name)}\\s*$`,
            $options: "i",
          },
        },
        {
          $setOnInsert: {
            userEmail: email,
            name,
            assignedDrips: [],
          },
        },
        { upsert: true, new: false, lean: true }
      ).exec();
    }

    // 2) Fetch folders *only* for this user, strictly by userEmail
    const raw = await Folder.find({
      userEmail: email,
    })
      .sort({ createdAt: 1, _id: 1 })
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

    // ✅ custom folders sorted by most recently updated (then createdAt, then name)
    custom.sort((a, b) => {
      const au = a.updatedAt?.getTime() ?? 0;
      const bu = b.updatedAt?.getTime() ?? 0;
      if (bu !== au) return bu - au;

      const ac = a.createdAt?.getTime() ?? 0;
      const bc = b.createdAt?.getTime() ?? 0;
      if (bc !== ac) return bc - ac;

      return a.name.localeCompare(b.name);
    });

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

    // 4) Counts per folder for this user, based ONLY on folderId + userEmail
    const byIdAgg = await (Lead as any).aggregate([
      {
        $match: {
          userEmail: email,
          folderId: { $exists: true, $ne: null },
        },
      },
      {
        $addFields: {
          fid: { $toString: "$folderId" },
        },
      },
      {
        $group: {
          _id: "$fid",
          n: { $sum: 1 },
        },
      },
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
      return {
        ...f,
        _id: idStr,
        leadCount: base + extra,
      };
    });

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (err) {
    console.error("❌ get-folders error:", err);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

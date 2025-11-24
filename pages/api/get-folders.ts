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
  assignedDrips?: any[];
  createdAt?: any;
  updatedAt?: any;
};

function normalizeName(s?: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}
function normKey(s?: string) {
  return normalizeName(s).toLowerCase();
}
function toLeanFolder(doc: DBFolder, fallbackEmail: string): LeanFolder {
  return {
    _id: String(doc._id),
    name: normalizeName(doc.name),
    userEmail: String(doc.userEmail ?? fallbackEmail),
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
  res.setHeader("X-Folders-Impl", "strict-per-user-v1");

  try {
    const session = await getServerSession(req, res, authOptions);
    const email =
      typeof session?.user?.email === "string"
        ? session.user.email.toLowerCase()
        : "";

    if (!email) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await dbConnect();

    // 1) Ensure THIS user has the 3 system folders (no Vet Leads here)
    for (const name of SYSTEM_FOLDERS) {
      await Folder.findOneAndUpdate(
        { userEmail: email, name },
        { $setOnInsert: { userEmail: email, name, assignedDrips: [] } },
        { upsert: true, new: false, lean: true }
      ).exec();
    }

    // 2) Fetch only this user's folders
    const raw = await Folder.find({ userEmail: email })
      .sort({ createdAt: -1 })
      .lean<DBFolder[]>()
      .exec();

    const all = raw.map((r) => toLeanFolder(r, email));

    // 3) Split system vs custom for THIS user
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

    // For each system bucket, keep the oldest doc as canonical
    const canonicalByKey = new Map<string, LeanFolder>();
    for (const [key, arr] of systemBuckets) {
      arr.sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      });
      canonicalByKey.set(key, arr[0]!);
    }

    // 4) Count leads strictly by folderId for THIS user
    const byIdAgg = await (Lead as any).aggregate([
      {
        $match: {
          userEmail: email,
          folderId: { $exists: true, $ne: null },
        },
      },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);

    const byId = new Map<string, number>();
    for (const r of byIdAgg) {
      byId.set(String(r._id), Number(r.n) || 0);
    }

    // 5) Optional "Unsorted" bucket for this user (no folderId)
    const unsortedCount = await Lead.countDocuments({
      userEmail: email,
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    let unsortedFolder: LeanFolder | null = null;
    const existingUnsorted = all.find((f) => normKey(f.name) === "unsorted");
    if (existingUnsorted) {
      unsortedFolder = existingUnsorted;
    } else if (unsortedCount > 0) {
      // create one if they actually have unsorted leads
      const created = await Folder.findOneAndUpdate(
        { userEmail: email, name: "Unsorted" },
        { $setOnInsert: { userEmail: email, name: "Unsorted", assignedDrips: [] } },
        { new: true, upsert: true, lean: true }
      ).exec();
      if (created) {
        unsortedFolder = toLeanFolder(created as any, email);
      }
    }

    // 6) Build final ordered list: custom, then system, then optional Unsorted
    const systemOrdered = SYSTEM_FOLDERS.map((n) =>
      canonicalByKey.get(normKey(n))
    ).filter(Boolean) as LeanFolder[];

    const ordered: LeanFolder[] = [...custom, ...systemOrdered];

    if (unsortedFolder) {
      ordered.push(unsortedFolder);
    }

    const foldersWithCounts = ordered.map((f) => {
      const idStr = String(f._id);
      const base = byId.get(idStr) || 0;
      const extra =
        unsortedFolder && idStr === String(unsortedFolder._id)
          ? unsortedCount
          : 0;
      return {
        ...f,
        _id: idStr,
        leadCount: base + extra,
      };
    });

    console.info(
      "[get-folders] userEmail=%s folders=%d",
      email,
      foldersWithCounts.length
    );

    return res.status(200).json({ folders: foldersWithCounts });
  } catch (error) {
    console.error("❌ get-folders error:", error);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

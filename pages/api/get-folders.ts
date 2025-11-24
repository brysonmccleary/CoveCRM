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
function resolveOwnerEmail(doc: DBFolder): string {
  const direct =
    (typeof doc.userEmail === "string" && doc.userEmail) ||
    (typeof doc.user === "string" && doc.user) ||
    "";
  return direct.toLowerCase();
}
function toLeanFolder(doc: DBFolder): LeanFolder {
  return {
    _id: String(doc._id),
    name: normalizeName(doc.name),
    userEmail: resolveOwnerEmail(doc),
    assignedDrips: doc.assignedDrips ?? [],
    createdAt: doc.createdAt ? new Date(doc.createdAt) : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // prevent stale caches while we’re stabilizing
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "sys-v6");

  try {
    const session = await getServerSession(req, res, authOptions);
    const emailRaw = typeof session?.user?.email === "string" ? session.user.email : "";
    const email = emailRaw.toLowerCase();
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Idempotently ensure the 3 system folders exist for THIS user only
    for (const name of SYSTEM_FOLDERS) {
      await Folder.findOneAndUpdate(
        {
          userEmail: email,
          name: { $regex: `^\\s*${escapeRegex(name)}\\s*$`, $options: "i" },
        },
        { $setOnInsert: { userEmail: email, user: email, name, assignedDrips: [] } },
        { upsert: true, new: false, lean: true }
      ).exec();
    }

    // 2) Fetch raw folders that COULD belong to this user
    //    We still query narrowly, but we’ll also enforce owner in JS below.
    const raw = await Folder.find({
      $or: [{ userEmail: email }, { user: email }],
    })
      .sort({ createdAt: -1 })
      .lean<DBFolder[]>()
      .exec();

    // 3) Normalize + HARD scope to this user
    const all = raw.map((r) => toLeanFolder(r));

    const scoped = all.filter((f) => {
      const owner = (f.userEmail || "").toLowerCase();
      const ok = !!owner && owner === email;
      if (!ok) {
        // Safety log – should basically never fire, but helps if something is weird.
        console.warn("[get-folders] filtered out folder not owned by user", {
          owner,
          email,
          _id: f._id,
          name: f.name,
        });
      }
      return ok;
    });

    // 4) Partition: custom vs system (using *trimmed* case-insensitive key)
    const systemKeys = new Set(SYSTEM_FOLDERS.map((n) => normKey(n)));
    const custom: LeanFolder[] = [];
    const systemBuckets = new Map<string, LeanFolder[]>();

    for (const f of scoped) {
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

    // For each system bucket, choose the canonical doc (oldest by createdAt, then by _id)
    const canonicalByKey = new Map<string, LeanFolder>();
    for (const [key, arr] of systemBuckets) {
      arr.sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      });
      canonicalByKey.set(key, arr[0]); // arr is non-empty
    }

    // 5) Counts by folderId (strict by ObjectId string) – stays scoped by userEmail
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: email, folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // 6) Optional legacy "Unsorted" handling (only if present)
    const unsorted = scoped
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

    // 7) Build final ordered list: custom, then canonical system in fixed order
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

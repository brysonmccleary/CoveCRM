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
  leadCount?: number;
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
function ciExact(value: string) {
  return { $regex: `^${escapeRegex(value)}$`, $options: "i" as const };
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
  // prevent stale caches while we’re stabilizing
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "sys-v6");

  try {
    const session = await getServerSession(req, res, authOptions);
    const email = typeof session?.user?.email === "string" ? session.user.email : "";
    if (!email) return res.status(401).json({ message: "Unauthorized" });

    await dbConnect();

    // 1) Fetch all folders for this user (case-insensitive match for legacy docs)
    const raw = await Folder.find({ userEmail: ciExact(email) })
      .sort({ createdAt: -1 })
      .lean<DBFolder[]>()
      .exec();

    const all = raw.map((r) => toLeanFolder(r, email));

    // 2) Partition: custom vs system (case-insensitive)
    const systemKeys = new Set(SYSTEM_FOLDERS.map((n) => normKey(n)));
    const custom: LeanFolder[] = [];
    const systemSeen = new Map<string, LeanFolder[]>();

    for (const f of all) {
      const key = normKey(f.name);
      if (systemKeys.has(key)) {
        const arr = systemSeen.get(key) || [];
        arr.push(f);
        systemSeen.set(key, arr);
      } else {
        custom.push(f);
      }
    }

    // Custom alphabetical
    custom.sort((a, b) => a.name.localeCompare(b.name));

    // Canonicalize any legacy system docs if they exist (we won’t create them here)
    const canonicalByKey = new Map<string, LeanFolder>();
    for (const [key, arr] of systemSeen) {
      arr.sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      });
      canonicalByKey.set(key, arr[0]);
    }

    // 3) Counts by folderId (strict on id; case-insensitive on userEmail)
    const byIdAgg = await (Lead as any).aggregate([
      { $match: { userEmail: ciExact(email), folderId: { $exists: true, $ne: null } } },
      { $addFields: { fid: { $toString: "$folderId" } } },
      { $group: { _id: "$fid", n: { $sum: 1 } } },
    ]);
    const byId = new Map<string, number>();
    for (const r of byIdAgg) byId.set(String(r._id), Number(r.n) || 0);

    // 4) Optional legacy "Unsorted" handling (only if present)
    const unsorted = all
      .filter((f) => normKey(f.name) === "unsorted")
      .sort((a, b) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      })[0];
    const unsortedIdStr = unsorted ? String(unsorted._id) : null;
    const unsortedCount = await Lead.countDocuments({
      userEmail: ciExact(email),
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    // 5) Build final list: custom + any existing canonical system docs (we never create them here)
    const systemOrdered = SYSTEM_FOLDERS.map((n) => canonicalByKey.get(normKey(n))).filter(Boolean) as LeanFolder[];
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

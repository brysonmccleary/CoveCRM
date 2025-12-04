// /pages/api/mobile/folders.ts
import type { NextApiRequest, NextApiResponse } from "next";
import jwt from "jsonwebtoken";
import mongooseConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";
import User from "@/models/User";

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

// ---- Mobile auth helper (JWT from /api/mobile/login) ----
const MOBILE_JWT_SECRET =
  process.env.MOBILE_JWT_SECRET ||
  process.env.NEXTAUTH_SECRET ||
  "dev-mobile-secret";

function getEmailFromAuth(req: NextApiRequest): string | null {
  const auth = req.headers.authorization || "";
  const [scheme, token] = auth.split(" ");
  if (scheme !== "Bearer" || !token) return null;

  try {
    const payload = jwt.verify(token, MOBILE_JWT_SECRET) as any;
    const emailRaw = (payload?.email || payload?.sub || "").toString();
    const email = emailRaw.trim().toLowerCase();
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Snap the JWT email to the canonical email stored on the User doc.
 * This fixes any case / whitespace / alias mismatches so mobile sees
 * the exact same folders/leads as the web app.
 */
async function resolveEffectiveEmail(rawEmail: string): Promise<string> {
  const trimmed = (rawEmail || "").trim();
  if (!trimmed) return trimmed;

  try {
    const user = await User.findOne(
      {
        email: {
          $regex: `^${escapeRegex(trimmed)}$`,
          $options: "i",
        },
      },
      { email: 1 },
    )
      .lean()
      .exec();

    if (user?.email) {
      return String(user.email).trim().toLowerCase();
    }
  } catch (e) {
    console.warn("[mobile/folders] resolveEffectiveEmail error:", e);
  }

  return trimmed.toLowerCase();
}

// ---- Handler (same logic as /api/get-folders, but mobile auth) ----
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Folders-Impl", "per-user-system-final-mobile");

  try {
    const jwtEmail = getEmailFromAuth(req);
    if (!jwtEmail) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    await mongooseConnect();

    const email = await resolveEffectiveEmail(jwtEmail);
    console.log("[mobile/folders] email:", email, "(jwt:", jwtEmail, ")");

    // 1) Ensure system folders exist for *this* user only
    for (const name of SYSTEM_FOLDERS) {
      await (Folder as any)
        .findOneAndUpdate(
          {
            userEmail: email,
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
          { upsert: true, new: false, lean: true },
        )
        .exec();
    }

    // 2) Fetch folders only for this user
    const raw = await (Folder as any)
      .find({ userEmail: email })
      .sort({ createdAt: 1, _id: 1 })
      .lean()
      .exec();

    const all: LeanFolder[] = (raw as DBFolder[]).map((r: DBFolder) =>
      toLeanFolder(r, email),
    );

    // 3) Partition: custom vs system
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

    custom.sort((a: LeanFolder, b: LeanFolder) => a.name.localeCompare(b.name));

    const canonicalByKey = new Map<string, LeanFolder>();
    for (const [key, arr] of systemBuckets) {
      arr.sort((a: LeanFolder, b: LeanFolder) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      });
      canonicalByKey.set(key, arr[0]);
    }

    // 4) Counts per folder for this user
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

    const unsorted = all
      .filter((f: LeanFolder) => normKey(f.name) === "unsorted")
      .sort((a: LeanFolder, b: LeanFolder) => {
        const ad = a.createdAt?.getTime() ?? 0;
        const bd = b.createdAt?.getTime() ?? 0;
        return ad - bd || a._id.localeCompare(b._id);
      })[0];

    const unsortedIdStr = unsorted ? String(unsorted._id) : null;
    const unsortedCount = await Lead.countDocuments({
      userEmail: email,
      $or: [{ folderId: { $exists: false } }, { folderId: null }],
    });

    const systemOrdered = SYSTEM_FOLDERS.map((n) =>
      canonicalByKey.get(normKey(n)),
    ).filter(Boolean) as LeanFolder[];

    const ordered: LeanFolder[] = [...custom, ...systemOrdered];

    const foldersWithCounts = ordered.map((f: LeanFolder) => {
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
    console.error("❌ mobile/folders error:", err);
    return res.status(500).json({ message: "Failed to fetch folders" });
  }
}

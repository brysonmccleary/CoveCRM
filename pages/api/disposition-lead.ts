// /pages/api/disposition-lead.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";
import {
  SYSTEM_FOLDERS,
  canonicalizeName,
} from "@/lib/systemFolders";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeName(s?: string) {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

// Map canonical form -> official system name
const CANON_TO_OFFICIAL = new Map(
  SYSTEM_FOLDERS.map((n) => [canonicalizeName(n), n] as const)
);

function coerceToOfficialIfSystemLike(name: string): {
  finalName: string;
  isSystem: boolean;
} {
  const canon = canonicalizeName(name);
  const official = CANON_TO_OFFICIAL.get(canon);
  if (official) return { finalName: official, isSystem: true };
  return { finalName: normalizeName(name), isSystem: false };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Disposition-Impl", "sys-v1");

  try {
    const session = await getServerSession(req, res, authOptions);
    const userEmail = typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
    if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

    const { leadId, newFolderName } = (req.body ?? {}) as {
      leadId?: string;
      newFolderName?: string;
    };

    const rawName = normalizeName(newFolderName || "");
    if (!leadId || !rawName) return res.status(400).json({ message: "Missing required fields." });

    await dbConnect();

    // Verify the lead belongs to this user (pre-transaction read is fine; we'll match again on update)
    const existing = await Lead.findOne({ _id: leadId, userEmail })
      .select({ _id: 1, folderId: 1, status: 1 })
      .lean<{ _id: any; folderId?: any; status?: string } | null>();

    if (!existing) return res.status(404).json({ message: "Lead not found." });

    const { finalName, isSystem } = coerceToOfficialIfSystemLike(rawName);

    const mongoSession = await mongoose.startSession();
    try {
      let targetFolderId: mongoose.Types.ObjectId | null = null;

      await mongoSession.withTransaction(async () => {
        if (isSystem) {
          // Bypass Mongoose validators/hooks: ensure system folder exists via raw collection upsert
          const filter = {
            userEmail,
            name: { $regex: `^\\s*${escapeRegex(finalName)}\\s*$`, $options: "i" },
          };
          const up = await Folder.collection.updateOne(
            filter as any,
            { $setOnInsert: { userEmail, name: finalName, assignedDrips: [] } },
            { upsert: true, session: mongoSession }
          );

          // Fetch the folder _id (either upserted or matched)
          if (up.upsertedId) {
            // @ts-ignore - driver returns { _id: <ObjectId> }
            targetFolderId = up.upsertedId._id as mongoose.Types.ObjectId;
          } else {
            const f = await Folder.findOne(filter).select({ _id: 1 }).session(mongoSession).lean<{ _id: any } | null>();
            if (!f) throw new Error("Failed to resolve system folder.");
            targetFolderId = f._id as any;
          }
        } else {
          // Non-system folder: regular guarded upsert is fine
          const nameRegex = new RegExp(`^${escapeRegex(finalName)}$`, "i");
          const f = await Folder.findOneAndUpdate(
            { userEmail, name: nameRegex },
            { $setOnInsert: { userEmail, name: finalName, assignedDrips: [] as string[] } },
            { new: true, upsert: true, session: mongoSession }
          ).select({ _id: 1, name: 1 });
          if (!f) throw new Error("Failed to resolve folder.");
          targetFolderId = f._id as any;
        }

        // Move the lead (and set status if moving into a system folder)
        const setFields: Record<string, any> = {
          folderId: targetFolderId,
          folderName: finalName,
          ["Folder Name"]: finalName,
          folder: finalName,
          updatedAt: new Date(),
        };
        if (isSystem) setFields.status = finalName;

        const write = await Lead.updateOne(
          { _id: leadId, userEmail },
          { $set: setFields },
          { session: mongoSession }
        );
        if (write.matchedCount === 0) throw new Error("Lead not found on update.");
      });

      // Best-effort socket notify after commit
      try {
        let io = (res as any)?.socket?.server?.io;
        if (!io) io = initSocket(res as any);
        io?.to(userEmail).emit("lead:updated", {
          _id: String(leadId),
          folderName: finalName,
          status: isSystem ? finalName : existing?.status,
          updatedAt: new Date(),
        });
      } catch {
        /* non-fatal */
      }

      return res.status(200).json({
        success: true,
        message: "Lead moved.",
        folderName: finalName,
        isSystem,
      });
    } finally {
      mongoSession.endSession();
    }
  } catch (e: any) {
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  }
}

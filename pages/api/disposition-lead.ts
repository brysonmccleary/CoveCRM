import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import mongoose from "mongoose";
import Lead from "@/models/Lead";
import Folder from "@/models/Folder";
import { initSocket } from "@/lib/socket";
import { folderNameForDisposition } from "@/lib/dispositionToFolder";
import { isSystemFolderName } from "@/lib/systemFolders";

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ALLOW_STATUS_SET = new Set([
  "sold",
  "not interested",
  "booked appointment",
  "resolved",
  "no show", // ← NEW
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, newFolderName } = (req.body ?? {}) as { leadId?: string; newFolderName?: string };
  const rawName = String(newFolderName || "").trim();
  if (!leadId || !rawName) return res.status(400).json({ message: "Missing required fields." });

  // Canonicalize disposition → pretty target name (includes No Show)
  const canonical = folderNameForDisposition(rawName); // "Sold" | "Not Interested" | "Booked Appointment" | "No Show" | "Resolved" | null
  const desiredFolderName = canonical ?? rawName;
  const desiredLower = desiredFolderName.toLowerCase();

  await dbConnect();
  const mongoSession = await mongoose.startSession();

  try {
    let targetFolderId: mongoose.Types.ObjectId | null = null;
    let previousStatus: string | undefined;
    let fromFolderName: string | undefined;
    let toFolderName: string | undefined;

    await mongoSession.withTransaction(async () => {
      const existing = await Lead.findOne({ _id: leadId, userEmail })
        .select({ _id: 1, folderId: 1, status: 1 })
        .session(mongoSession)
        .lean<{ _id: any; folderId?: any; status?: string } | null>();
      if (!existing) throw new Error("Lead not found.");

      previousStatus = existing.status;

      if (existing.folderId) {
        const from = await Folder.findOne({ _id: existing.folderId, userEmail })
          .select({ name: 1 })
          .session(mongoSession)
          .lean<{ name?: string } | null>();
        fromFolderName = from?.name;
      }

      let target: { _id: mongoose.Types.ObjectId; name: string } | null = null;

      if (isSystemFolderName(desiredFolderName)) {
        // 🔒 deterministically resolve system folder, creating if missing (covers first-time use)
        const SYSTEM_NAMES = ["Sold", "Not Interested", "Booked Appointment", "No Show"];
        const systemRows = await Folder.find({ userEmail, name: { $in: SYSTEM_NAMES } })
          .select({ _id: 1, name: 1 })
          .session(mongoSession)
          .lean<{ _id: mongoose.Types.ObjectId; name: string }[]>();

        let exact = systemRows.find((r) => String(r.name).toLowerCase() === desiredLower);

        if (!exact) {
          const upserted = await Folder.findOneAndUpdate(
            { userEmail, name: desiredFolderName },
            { $setOnInsert: { userEmail, name: desiredFolderName, assignedDrips: [] as string[] } },
            { new: true, upsert: true, session: mongoSession }
          ).select({ _id: 1, name: 1 });

          if (!upserted) {
            throw Object.assign(
              new Error(`System folder "${desiredFolderName}" not found for user.`),
              { status: 400 }
            );
          }
          exact = { _id: upserted._id as any, name: upserted.name as any };
        }

        target = exact;
      } else {
        // Non-system: exact (case-insensitive) resolve or create
        const nameRegex = new RegExp(`^${escapeRegex(desiredFolderName)}$`, "i");
        const upserted = await Folder.findOneAndUpdate(
          { userEmail, name: nameRegex },
          { $setOnInsert: { userEmail, name: desiredFolderName, assignedDrips: [] as string[] } },
          { new: true, upsert: true, session: mongoSession }
        ).select({ _id: 1, name: 1 });

        if (!upserted) throw new Error("Failed to resolve target folder.");
        target = { _id: upserted._id as any, name: upserted.name as any };
      }

      targetFolderId = target!._id as any;
      toFolderName = target!.name;

      // Final assert for system moves (belt + suspenders)
      if (isSystemFolderName(desiredFolderName)) {
        if (String(toFolderName).toLowerCase() !== desiredLower) {
          throw Object.assign(
            new Error(
              `Guard: about to move to wrong system folder (wanted "${desiredFolderName}", got "${toFolderName}")`
            ),
            { status: 500 }
          );
        }
      }

      const setFields: Record<string, any> = {
        folderId: targetFolderId,
        folderName: toFolderName,
        ["Folder Name"]: toFolderName,
        folder: toFolderName,
        updatedAt: new Date(),
      };
      if (ALLOW_STATUS_SET.has(desiredLower)) {
        setFields.status = desiredFolderName;
      }

      const write = await Lead.updateOne(
        { _id: leadId, userEmail },
        { $set: setFields },
        { session: mongoSession }
      );
      if (write.matchedCount === 0) throw new Error("Lead not found after update.");
    });

    // Log (for acceptance criteria)
    try {
      console.log("disposition-lead", {
        leadId,
        userEmail,
        fromFolder: fromFolderName || null,
        toFolder: toFolderName || null,
        statusBefore: previousStatus || null,
        statusAfter: ALLOW_STATUS_SET.has(desiredLower) ? desiredFolderName : previousStatus || null,
      });
    } catch {}

    // Socket notify (best-effort)
    try {
      let io = (res as any)?.socket?.server?.io;
      if (!io) io = initSocket(res as any);
      io?.to(userEmail).emit("lead:updated", {
        _id: String(leadId),
        folderId: String(targetFolderId),
        folderName: toFolderName,
        status: ALLOW_STATUS_SET.has(desiredLower) ? desiredFolderName : previousStatus,
        updatedAt: new Date(),
      });
    } catch (e) {
      console.warn("disposition-lead: socket emit failed (non-fatal):", e);
    }

    return res.status(200).json({
      success: true,
      message: "Lead moved.",
      toFolderId: String(targetFolderId),
      folderName: toFolderName,
      status: ALLOW_STATUS_SET.has(desiredLower) ? desiredFolderName : previousStatus,
    });
  } catch (e: any) {
    const code = e?.status && Number.isInteger(e.status) ? e.status : 500;
    if (code !== 500) {
      console.warn("disposition-lead guarded error:", e?.message);
      return res.status(code).json({ message: e?.message || "Bad Request" });
    }
    console.error("disposition-lead error:", e);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    mongoSession.endSession();
  }
}

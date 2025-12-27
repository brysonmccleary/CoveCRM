// lib/drips/enrollOnNewLead.ts
import { DateTime } from "luxon";
import mongoose, { Types } from "mongoose";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripEnrollment from "@/models/DripEnrollment";

/**
 * StartMode:
 * - "now" / "immediate"  => enqueue immediately (nextSendAt = now)
 * - "nextWindow"        => enqueue for the next 9:00 AM PT window
 */
export type StartMode = "now" | "immediate" | "nextWindow";

/**
 * Source tags must match the enum in DripEnrollment:
 *   enum: ["manual-lead", "folder-bulk", "sheet-bulk"]
 */
export type EnrollSource = "manual-lead" | "folder-bulk" | "sheet-bulk";

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

function computeNextWindowPT(now = DateTime.now().setZone(PT_ZONE)): Date {
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  const when = now < today9 ? today9 : today9.plus({ days: 1 });
  return when.toJSDate();
}

function toObjectId(id: string | Types.ObjectId): Types.ObjectId {
  if (id instanceof Types.ObjectId) return id;
  // If invalid, create a dummy that will never match
  if (!Types.ObjectId.isValid(id)) return new Types.ObjectId("000000000000000000000000");
  return new Types.ObjectId(id);
}

function normalizeStartMode(mode?: StartMode): "now" | "nextWindow" {
  if (!mode) return "now";
  if (mode === "immediate") return "now";
  return mode;
}

/**
 * Idempotently enroll a new lead into any active drip watchers on the folder.
 * - Does NOT send SMS — only creates/upserts DripEnrollment with nextSendAt.
 * - Strictly idempotent via the (leadId, campaignId, status in [active|paused]) unique index.
 */
export async function enrollOnNewLeadIfWatched(params: {
  userEmail: string;
  folderId: string; // ObjectId string
  leadId: string;   // ObjectId string
  startMode?: StartMode; // default: "now"
  source?: EnrollSource; // default: "manual-lead"
}): Promise<void> {
  const { userEmail, folderId, leadId } = params;

  const startMode = normalizeStartMode(params.startMode ?? "now");
  const source: EnrollSource = params.source ?? "manual-lead";

  // ✅ DripFolderEnrollment.folderId is ObjectId, so cast here for reliable matching
  const folderObjectId = toObjectId(folderId);

  // Find all active watchers for this folder & tenant
  const watchers = await DripFolderEnrollment.find({
    userEmail,
    folderId: folderObjectId,
    active: true,
  })
    .select({ _id: 1, campaignId: 1, startMode: 1 })
    .lean();

  if (!watchers?.length) return;

  const now = new Date();

  await Promise.all(
    watchers.map(async (w: any) => {
      const campaignId = String(w.campaignId);

      // Watcher has enum ["immediate", "nextWindow"]
      const watcherModeRaw = String(w?.startMode || "").trim();
      const watcherMode: "now" | "nextWindow" =
        watcherModeRaw === "nextWindow" ? "nextWindow" : "now";

      // Caller can override watcher mode:
      // - if caller says "now", force now
      // - if caller says "nextWindow", force nextWindow
      // otherwise use watcher preference
      const effectiveMode = startMode === "now" ? "now" : watcherMode;

      const effectiveWhen =
        effectiveMode === "nextWindow" ? computeNextWindowPT() : now;

      await DripEnrollment.findOneAndUpdate(
        {
          leadId,
          campaignId,
          status: { $in: ["active", "paused"] },
        },
        {
          $setOnInsert: {
            userEmail,
            status: "active",
            cursorStep: 0,
            nextSendAt: effectiveWhen,
            startedAt: now,
            source,
          },
        },
        { upsert: true, new: false }
      ).lean();
    })
  );
}

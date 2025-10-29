// lib/drips/enrollOnNewLead.ts
import { DateTime } from "luxon";
import DripFolderEnrollment from "@/models/DripFolderEnrollment";
import DripEnrollment from "@/models/DripEnrollment";

/**
 * StartMode:
 * - "now"         => enqueue immediately (nextSendAt = now)
 * - "nextWindow"  => enqueue for the next 9:00 AM PT window
 */
export type StartMode = "now" | "nextWindow";

/**
 * Source tags must match the existing enum in DripEnrollment:
 *   enum: ["manual-lead", "folder-bulk", "sheet-bulk"]
 * Choose per caller:
 *   - manual create endpoint   => "manual-lead"
 *   - CSV import               => "folder-bulk"
 *   - Google Sheets poller     => "sheet-bulk"
 */
export type EnrollSource = "manual-lead" | "folder-bulk" | "sheet-bulk";

const PT_ZONE = "America/Los_Angeles";
const SEND_HOUR_PT = 9;

function computeNextWindowPT(now = DateTime.now().setZone(PT_ZONE)): Date {
  const today9 = now.set({ hour: SEND_HOUR_PT, minute: 0, second: 0, millisecond: 0 });
  const when = now < today9 ? today9 : today9.plus({ days: 1 });
  return when.toJSDate();
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
  const startMode: StartMode = params.startMode ?? "now";
  const source: EnrollSource = params.source ?? "manual-lead";

  // Find all active watchers for this folder & tenant
  const watchers = await DripFolderEnrollment.find({
    userEmail,
    folderId,
    active: true,
  })
    .select({ _id: 1, campaignId: 1, startMode: 1 })
    .lean();

  if (!watchers?.length) return;

  // For each watcher, upsert a DripEnrollment (idempotent)
  const now = new Date();
  const nextWhen =
    startMode === "nextWindow" ? computeNextWindowPT() : now;

  // We purposely use $setOnInsert to avoid mutating existing active/paused enrollments,
  // which guarantees we won't re-schedule or double-send on re-imports.
  await Promise.all(
    watchers.map(async (w) => {
      const campaignId = String(w.campaignId);

      // If the watcher itself prefers "nextWindow", respect it unless caller forced a different mode.
      const effectiveWhen =
        startMode === "now"
          ? now
          : computeNextWindowPT();

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
        { upsert: true, new: false } // new:false so nothing is returned/changed if it already exists
      ).lean();
    })
  );
}

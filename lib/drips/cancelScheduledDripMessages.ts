// lib/drips/cancelScheduledDripMessages.ts
//
// Cancel all pending ScheduledDripMessage records for a lead.
// Called when:
//   - Lead sends STOP / opts out
//   - Lead sends any inbound reply (pause behavior)
//   - Lead status becomes booked/sold/not interested/DNC
//   - Enrollment is explicitly canceled

import dbConnect from "@/lib/mongooseConnect";
import ScheduledDripMessage from "@/models/ScheduledDripMessage";
import mongoose from "mongoose";

export type CancelScope = "lead" | "enrollment";

export interface CancelScheduledDripMessagesParams {
  userEmail: string;
  leadId?: string | mongoose.Types.ObjectId;
  enrollmentId?: string | mongoose.Types.ObjectId;
  cancelReason: string;
}

/**
 * Cancel all pending ScheduledDripMessage records for the given lead or enrollment.
 * Returns the count of records canceled.
 *
 * Scope: if enrollmentId is provided, only that enrollment's records are canceled.
 * If only leadId is provided, ALL pending records for that lead are canceled.
 */
export async function cancelScheduledDripMessages(
  params: CancelScheduledDripMessagesParams
): Promise<number> {
  await dbConnect();

  const { userEmail, leadId, enrollmentId, cancelReason } = params;

  const filter: Record<string, any> = {
    userEmail,
    status: { $in: ["pending", "sending"] },
  };

  if (enrollmentId) {
    filter.enrollmentId = new mongoose.Types.ObjectId(String(enrollmentId));
  } else if (leadId) {
    filter.leadId = new mongoose.Types.ObjectId(String(leadId));
  } else {
    console.warn("[cancelScheduledDripMessages] Neither leadId nor enrollmentId provided — aborting");
    return 0;
  }

  try {
    const result = await ScheduledDripMessage.updateMany(
      filter,
      {
        $set: {
          status: "canceled",
          canceledAt: new Date(),
          cancelReason,
          processingAt: null,
          lockedAt: null,
        },
      }
    );
    const count = (result as any).modifiedCount ?? (result as any).nModified ?? 0;
    if (count > 0) {
      console.log(
        `[cancelScheduledDripMessages] Canceled ${count} pending record(s) — reason: ${cancelReason}`,
        { userEmail, leadId: String(leadId || ""), enrollmentId: String(enrollmentId || "") }
      );
    }
    return count;
  } catch (err) {
    console.error("[cancelScheduledDripMessages] Error:", err);
    return 0;
  }
}

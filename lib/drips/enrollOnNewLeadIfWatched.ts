// lib/drips/enrollOnNewLeadIfWatched.ts
// Minimal, safe helper: if a folder has assigned drips, mark the lead so your
// drip runner can start immediately. No external deps, no behavioral changes elsewhere.

import dbConnect from "@/lib/mongooseConnect";
import Folder from "@/models/Folder";
import Lead from "@/models/Lead";

type Args = {
  userEmail: string;
  folderId: string; // stringified ObjectId
  leadId: string;   // stringified ObjectId
};

/**
 * Checks if the folder has assigned drips; if so, flags the lead for immediate enrollment.
 * Returns a small result object for logging/observability.
 */
export async function enrollOnNewLeadIfWatched(
  { userEmail, folderId, leadId }: Args
): Promise<{ started: boolean; reason?: string }> {
  try {
    await dbConnect();

    const folder = await Folder.findOne({ _id: folderId, userEmail })
      .select("_id name assignedDrips")
      .lean<{ _id: any; name: string; assignedDrips?: any[] }>();

    if (!folder) return { started: false, reason: "folder-not-found" };

    const hasAssigned =
      Array.isArray(folder.assignedDrips) && folder.assignedDrips.length > 0;

    if (!hasAssigned) return { started: false, reason: "no-assigned-drips" };

    // Flag the lead for immediate enrollment; your drip runner can look for these fields.
    await Lead.updateOne(
      { _id: leadId, userEmail },
      {
        $set: {
          dripEnrollRequestedAt: new Date(),
          dripEnrollFolderId: folderId,
          dripEnrollHint: "immediate",
        },
      }
    );

    return { started: true };
  } catch (_err) {
    // Swallow errors to avoid import aborts; upstream flow should continue.
    return { started: false, reason: "error" };
  }
}

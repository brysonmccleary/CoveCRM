// /pages/api/cron/a2p-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile, { IA2PProfile } from "@/models/A2PProfile";
import User from "@/models/User";
import { sendA2PApprovedEmail } from "@/lib/email";

type A2PStatus = "pending" | "approved" | "declined";

function deriveStatus(doc: IA2PProfile): A2PStatus {
  if ((doc as any).messagingReady) return "approved";
  const reason = (doc as any).declinedReason;
  if (reason && String(reason).trim().length > 0) return "declined";
  return "pending";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    if (mongoose.connection.readyState === 0) {
      await dbConnect();
    }

    const profiles = await A2PProfile.find({}).lean();
    let updated = 0;
    let emailed = 0;

    for (const p of profiles) {
      const currentStatus = ((p as any).applicationStatus ||
        "pending") as A2PStatus;
      const nextStatus = deriveStatus(p as IA2PProfile);

      // Only update if it changed
      if (currentStatus !== nextStatus) {
        await A2PProfile.updateOne(
          { _id: (p as any)._id },
          { $set: { applicationStatus: nextStatus } },
        );
        updated++;
      }

      // One-time approved email
      if (
        nextStatus === "approved" &&
        !(p as any).approvalNotifiedAt &&
        (p as any).userId
      ) {
        const user = await User.findById((p as any).userId);
        if (user?.email) {
          try {
            await sendA2PApprovedEmail({
              to: user.email,
              name: user.name,
              dashboardUrl:
                process.env.NEXT_PUBLIC_BASE_URL ||
                process.env.BASE_URL ||
                undefined,
            });

            await A2PProfile.updateOne(
              { _id: (p as any)._id },
              {
                $set: {
                  approvalNotifiedAt: new Date(),
                  applicationStatus: "approved",
                },
              },
            );
            emailed++;
          } catch (e) {
            console.warn("[a2p-sync] email failed for", user.email, e);
          }
        }
      }
    }

    return res
      .status(200)
      .json({ ok: true, profiles: profiles.length, updated, emailed });
  } catch (e: any) {
    console.error("[a2p-sync] error:", e);
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

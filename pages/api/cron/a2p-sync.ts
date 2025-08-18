// /pages/api/cron/a2p-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile, { IA2PProfile, A2PStatus } from "@/models/A2PProfile";
import User from "@/models/User";
import { sendEmail } from "@/lib/email/sendEmail";

function deriveStatus(doc: IA2PProfile): A2PStatus {
  if (doc.messagingReady) return "approved";
  if (doc.declinedReason && doc.declinedReason.trim().length > 0) return "declined";
  return "pending";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
      const currentStatus = (p.applicationStatus || "pending") as A2PStatus;
      const nextStatus = deriveStatus(p as IA2PProfile);

      // Only update if it changed
      if (currentStatus !== nextStatus) {
        await A2PProfile.updateOne(
          { _id: p._id },
          { $set: { applicationStatus: nextStatus } }
        );
        updated++;
      }

      // Fire one-time approved email
      if (
        nextStatus === "approved" &&
        !p.approvalNotifiedAt &&
        p.userId
      ) {
        const user = await User.findById(p.userId);
        if (user?.email) {
          try {
            await sendEmail({
              to: user.email,
              subject: "🎉 Your A2P registration is approved",
              html: `
                <div style="font-family:system-ui,Arial,sans-serif;line-height:1.5">
                  <h2 style="margin:0 0 8px">Congratulations!</h2>
                  <p>Your A2P 10DLC registration has been <b>approved</b>. You can now start sending texts in CoveCRM.</p>
                  <p style="margin-top:16px">If you have any questions, reply to this email and we’ll help right away.</p>
                  <p style="color:#666;font-size:12px;margin-top:24px">This is an automated message from CoveCRM.</p>
                </div>
              `,
              text:
                "Congratulations! Your A2P 10DLC registration has been approved. You can now start sending texts in CoveCRM.",
            });
            await A2PProfile.updateOne(
              { _id: p._id },
              { $set: { approvalNotifiedAt: new Date(), applicationStatus: "approved" } }
            );
            emailed++;
          } catch (e) {
            console.warn("[a2p-sync] email failed for", user.email, e);
          }
        }
      }
    }

    return res.status(200).json({ ok: true, profiles: profiles.length, updated, emailed });
  } catch (e: any) {
    console.error("[a2p-sync] error:", e);
    return res.status(500).json({ error: e?.message || "Unknown error" });
  }
}

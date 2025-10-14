// pages/api/a2p/sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
// ✅ use the notifications shim you added
import { sendA2PApprovedEmail, sendA2PDeclinedEmail } from "@/lib/a2p/notifications";

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";

const APPROVED = new Set(["approved","verified","active","in_use","registered"]);
const DECLINED_MATCH = /(reject|denied|failed)/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  if (CRON_SECRET && req.headers["x-cron-key"] !== CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  // only pending/not-ready need sync
  const candidates = await A2PProfile.find({
    $or: [
      { applicationStatus: { $in: [null, "pending"] } },
      { messagingReady: { $ne: true } },
    ],
  }).limit(200);

  const results: any[] = [];

  for (const a2p of candidates) {
    try {
      let brandStatus: string | undefined;
      let campStatus: string | undefined;

      if ((a2p as any).brandSid) {
        try {
          const brand = await client.messaging.v1.brandRegistrations((a2p as any).brandSid!).fetch();
          brandStatus = (brand as any).status || (brand as any).state;
        } catch {}
      }
      if ((a2p as any).usa2pSid && (a2p as any).messagingServiceSid) {
        try {
          const camp = await client.messaging.v1
            .services((a2p as any).messagingServiceSid!)
            .usAppToPerson((a2p as any).usa2pSid!)
            .fetch();
          campStatus = (camp as any).status || (camp as any).state;
        } catch {}
      }

      const statusStrings = [brandStatus, campStatus].filter(Boolean).map(s => String(s).toLowerCase());
      const isApproved = statusStrings.some(s => APPROVED.has(s));
      const isDeclined = statusStrings.some(s => DECLINED_MATCH.test(s));

      if (isApproved) {
        a2p.messagingReady = true;
        a2p.applicationStatus = "approved";
        // keep a more granular reg status if campaign is visible as approved; else 'ready'
        a2p.registrationStatus = statusStrings.some((s) => ["campaign_approved","approved","in_use","registered"].includes(s))
          ? "campaign_approved"
          : "ready";

        if (!a2p.approvalNotifiedAt) {
          try {
            const user = await User.findById(a2p.userId);
            if (user?.email) {
              await sendA2PApprovedEmail({
                to: user.email,
                name: user.name || undefined,
                dashboardUrl: `${BASE_URL}/settings/messaging`,
              });
            }
            a2p.approvalNotifiedAt = new Date();
          } catch (e) {
            console.warn("A2P sync approved email failed:", (e as any)?.message || e);
          }
        }
        a2p.lastSyncedAt = new Date();
        await a2p.save();
        results.push({ id: a2p._id, state: "approved" });
        continue;
      }

      if (isDeclined) {
        a2p.messagingReady = false;
        a2p.applicationStatus = "declined";
        a2p.registrationStatus = "rejected";
        a2p.lastSyncedAt = new Date();
        await a2p.save();

        try {
          const user = await User.findById(a2p.userId);
          if (user?.email) {
            await sendA2PDeclinedEmail({
              to: user.email,
              name: user.name || undefined,
              reason: a2p.declinedReason || "Declined by reviewers",
              helpUrl: `${BASE_URL}/help/a2p-checklist`,
            });
          }
        } catch (e) {
          console.warn("A2P sync declined email failed:", (e as any)?.message || e);
        }

        results.push({ id: a2p._id, state: "declined" });
        continue;
      }

      a2p.lastSyncedAt = new Date();
      await a2p.save();
      results.push({ id: a2p._id, state: "pending" });
    } catch (e) {
      console.warn("A2P sync item failed:", (e as any)?.message || e);
      results.push({ id: a2p._id, state: "error" });
    }
  }

  return res.status(200).json({ ok: true, checked: candidates.length, results });
}

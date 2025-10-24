// /pages/api/a2p/sync-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import twilio from "twilio";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { sendA2PApprovedEmail, sendA2PDeclinedEmail } from "@/lib/a2p/notifications";

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

const CRON_SECRET = process.env.CRON_SECRET || "";
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

const APPROVED = new Set(["approved","verified","active","in_use","registered"]);
const DECLINED_RE = /(reject|rejected|denied|failed|declined)/i;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  if (CRON_SECRET && req.headers["x-cron-key"] !== CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  const candidates = await A2PProfile.find({
    $or: [
      { applicationStatus: { $in: [null, "pending"] } },
      { messagingReady: { $ne: true } },
    ],
  }).limit(200);

  const out: Array<Record<string, any>> = [];

  for (const a2p of candidates) {
    try {
      // Pull current states (best-effort)
      let brandStatus = "unknown";
      if ((a2p as any).brandSid) {
        try {
          const b = await client.messaging.v1.brandRegistrations((a2p as any).brandSid!).fetch();
          brandStatus = (b as any).status || (b as any).state || "unknown";
        } catch {}
      }

      let campaignStatus = "unknown";
      const campaignSid = (a2p as any).usa2pSid || (a2p as any).campaignSid;
      if ((a2p as any).messagingServiceSid && campaignSid) {
        try {
          const c = await client.messaging.v1
            .services((a2p as any).messagingServiceSid!)
            .usAppToPerson(campaignSid)
            .fetch();
          campaignStatus = (c as any).status || (c as any).state || "unknown";
        } catch {}
      }

      const brandOK = APPROVED.has(String(brandStatus).toLowerCase());
      const campOK  = APPROVED.has(String(campaignStatus).toLowerCase());
      const declined = DECLINED_RE.test(String(brandStatus)) || DECLINED_RE.test(String(campaignStatus));

      // Lookup user now so we can mirror flags into User.a2p
      const user = await User.findById((a2p as any).userId);

      if (brandOK || campOK) {
        // A2PProfile flips
        a2p.messagingReady = true;
        a2p.applicationStatus = "approved";
        a2p.registrationStatus = campOK ? "campaign_approved" : "ready";
        a2p.declinedReason = undefined;
        a2p.lastSyncedAt = new Date();
        await a2p.save();

        // Mirror into User.a2p (critical for routing)
        if (user) {
          user.a2p = {
            ...(user.a2p || {}),
            brandSid: (a2p as any).brandSid || (user.a2p?.brandSid ?? undefined),
            campaignSid: (a2p as any).usa2pSid || (a2p as any).campaignSid || (user.a2p?.campaignSid ?? undefined),
            messagingServiceSid: (a2p as any).messagingServiceSid || (user.a2p?.messagingServiceSid ?? undefined),
            messagingReady: true,
            lastSyncedAt: new Date(),
          };
          await user.save();

          // One-time approved email (respect existing throttle if you use it elsewhere)
          if (!(a2p as any).approvalNotifiedAt) {
            try {
              if (user.email) {
                await sendA2PApprovedEmail({
                  to: user.email,
                  name: user.name || undefined,
                  dashboardUrl: `${BASE_URL}/settings/messaging`,
                });
              }
              (a2p as any).approvalNotifiedAt = new Date();
              await a2p.save();
            } catch {}
          }
        }

        out.push({ id: String(a2p._id), userId: String(user?._id || ""), state: "approved", brandStatus, campaignStatus });
        continue;
      }

      if (declined) {
        a2p.messagingReady = false;
        a2p.applicationStatus = "declined";
        a2p.registrationStatus = "rejected";
        a2p.lastSyncedAt = new Date();
        await a2p.save();

        if (user) {
          user.a2p = {
            ...(user.a2p || {}),
            messagingReady: false,
            lastSyncedAt: new Date(),
          };
          await user.save();

          try {
            if (user.email) {
              await sendA2PDeclinedEmail({
                to: user.email,
                name: user.name || undefined,
                reason: (a2p as any).declinedReason || "Declined by reviewers",
                helpUrl: `${BASE_URL}/help/a2p-checklist`,
              });
            }
          } catch {}
        }

        out.push({ id: String(a2p._id), userId: String(user?._id || ""), state: "declined", brandStatus, campaignStatus });
        continue;
      }

      a2p.lastSyncedAt = new Date();
      await a2p.save();
      if (user) {
        user.a2p = { ...(user.a2p || {}), lastSyncedAt: new Date() };
        await user.save();
      }

      out.push({ id: String(a2p._id), userId: String(user?._id || ""), state: "pending", brandStatus, campaignStatus });
    } catch (e: any) {
      out.push({ id: String(a2p._id), state: "error", error: e?.message || String(e) });
    }
  }

  return res.status(200).json({ ok: true, checked: candidates.length, results: out });
}

// /pages/api/cron/a2p-sync-all.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import twilio from "twilio";

const client = twilio(
  process.env.TWILIO_API_KEY_SID || process.env.TWILIO_ACCOUNT_SID!,
  (process.env.TWILIO_API_KEY_SECRET || process.env.TWILIO_AUTH_TOKEN)!
);

const CRON_SECRET = (process.env.CRON_SECRET || "").trim();
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

// status normalizers
const APPROVED = new Set(["approved", "verified", "active", "in_use", "registered"]);
const DECLINED = new Set(["rejected", "denied", "failed"]);

// Lazy-load email helpers if present; no-op if missing
async function sendApprovedEmailSafe(args: { to: string; name?: string; dashboardUrl: string }) {
  try {
    const mod: any = await import("@/lib/twilio/getClientForUser");
    if (typeof mod?.sendA2PApprovedEmail === "function") {
      await mod.sendA2PApprovedEmail(args);
    }
  } catch {
    /* no-op */
  }
}
async function sendDeclinedEmailSafe(args: { to: string; name?: string; reason: string; helpUrl: string }) {
  try {
    const mod: any = await import("@/lib/twilio/getClientForUser");
    if (typeof mod?.sendA2PDeclinedEmail === "function") {
      await mod.sendA2PDeclinedEmail(args);
    }
  } catch {
    /* no-op */
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Allow header or query token
  const provided =
    (Array.isArray(req.headers["x-cron-secret"]) ? req.headers["x-cron-secret"][0] : (req.headers["x-cron-secret"] as string | undefined)) ||
    (typeof req.query.token === "string" ? req.query.token : undefined);

  if (!CRON_SECRET || provided !== CRON_SECRET) {
    return res.status(403).json({ message: "Forbidden" });
  }

  try {
    await mongooseConnect();

    const profiles = await A2PProfile.find({}).lean();
    let updated = 0;

    for (const p of profiles) {
      try {
        const a2p = await A2PProfile.findById(p._id);
        if (!a2p) continue;

        const user = a2p.userId ? await User.findById(a2p.userId).lean() : null;

        let finalReady = !!a2p.messagingReady;
        let finalStatus = (a2p.registrationStatus as string) || "not_started";
        let finalDecline: string | undefined;

        // Brand status
        if (a2p.brandSid) {
          try {
            const brand = await client.messaging.v1.brandRegistrations(a2p.brandSid).fetch();
            const st = String((brand as any).status || (brand as any).state || "").toLowerCase();
            if (APPROVED.has(st)) finalStatus = "brand_approved";
            else if (DECLINED.has(st)) {
              finalStatus = "rejected";
              finalDecline = "Brand rejected";
            }
          } catch {
            /* ignore brand fetch errors */
          }
        }

        // Campaign status
        const campaignSid = (a2p as any).usa2pSid || a2p.campaignSid;
        if (campaignSid && a2p.messagingServiceSid) {
          try {
            const c = await client.messaging.v1.services(a2p.messagingServiceSid).usAppToPerson(campaignSid).fetch();
            const st = String((c as any).status || (c as any).state || "").toLowerCase();
            if (APPROVED.has(st)) {
              finalReady = true;
              finalStatus = "campaign_approved";
            } else if (DECLINED.has(st)) {
              finalReady = false;
              finalStatus = "rejected";
              finalDecline = "Campaign rejected";
            }
          } catch {
            /* ignore campaign fetch errors */
          }
        }

        // Persist + notify
        a2p.messagingReady = finalReady;
        a2p.registrationStatus = finalStatus as any;

        if (finalDecline) {
          a2p.applicationStatus = "declined";
          a2p.declinedReason = finalDecline;
          a2p.approvalHistory = [...(a2p.approvalHistory || []), { stage: "rejected", at: new Date(), note: finalDecline }];

          if (user?.email) {
            await sendDeclinedEmailSafe({
              to: user.email,
              name: user.name || undefined,
              reason: finalDecline,
              helpUrl: `${BASE_URL}/help/a2p-checklist`,
            });
          }
        } else if (finalReady) {
          a2p.applicationStatus = "approved";
          if (!a2p.approvalNotifiedAt && user?.email) {
            await sendApprovedEmailSafe({
              to: user.email,
              name: user.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
            a2p.approvalNotifiedAt = new Date();
          }
        }

        a2p.lastSyncedAt = new Date();
        await a2p.save();
        updated++;
      } catch (e) {
        console.warn("a2p sync-all item failed:", (e as any)?.message || e);
      }
    }

    return res.status(200).json({
      ok: true,
      updated,
      build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || null,
    });
  } catch (e: any) {
    console.error("cron a2p-sync-all error:", e?.message || e);
    return res.status(500).json({ message: e?.message || "Cron failed" });
  }
}

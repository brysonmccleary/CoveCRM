// /pages/api/cron/check-a2p-status.ts
import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import dbConnect from "@/lib/mongooseConnect";
import A2PProfile, { IA2PProfile, A2PRegistrationStatus } from "@/models/A2PProfile";
import User from "@/models/User";
import { sendA2PApprovedEmail /* optional: sendA2PStatusEmail */ } from "@/lib/email";

const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, CRON_SECRET } = process.env;
const client =
  TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

type Json = Record<string, unknown>;

function mapBrandStatus(s?: string): A2PRegistrationStatus | undefined {
  switch ((s || "").toUpperCase()) {
    case "APPROVED":
      return "brand_approved";
    case "PENDING":
    case "IN_REVIEW":
      return "brand_submitted";
    case "FAILED":
    case "SUSPENDED":
    case "DELETION_FAILED":
      return "rejected";
    default:
      return undefined;
  }
}

function mapCampaignStatus(s?: string): { stage?: A2PRegistrationStatus; ready: boolean } {
  switch ((s || "").toUpperCase()) {
    case "VERIFIED":
      return { stage: "campaign_approved", ready: true };
    case "PENDING":
    case "IN_PROGRESS":
      return { stage: "campaign_submitted", ready: false };
    case "FAILED":
      return { stage: "rejected", ready: false };
    default:
      return { ready: false };
  }
}

async function checkOne(profile: IA2PProfile): Promise<{ changed: boolean; approvedNow: boolean; details: Json }> {
  let changed = false;
  let approvedNow = false;
  const details: Json = {};

  // --- BRAND (BN...) ---
  if (client && profile.brandSid) {
    try {
      // https://www.twilio.com/docs/messaging/api/brand-registration-resource
      const brand: any = await (client as any).messaging.v1
        .brandRegistrations(profile.brandSid)
        .fetch();
      const newStage = mapBrandStatus(brand?.status);
      details.brandStatus = brand?.status;

      if (newStage && newStage !== profile.registrationStatus) {
        profile.approvalHistory = profile.approvalHistory || [];
        profile.approvalHistory.push({ stage: newStage, at: new Date(), note: "Brand status update" });
        profile.registrationStatus = newStage;
        changed = true;
      }
    } catch (e: any) {
      profile.lastError = `Brand fetch failed: ${e?.message || String(e)}`;
      changed = true;
    }
  }

  // --- CAMPAIGN / COMPLIANCE (QE under Messaging Service) ---
  if (client && profile.messagingServiceSid) {
    try {
      // Usa2p campaigns linked to the Messaging Service:
      // https://www.twilio.com/docs/messaging/api/usapp-to-person#usapp-to-person-properties
      const list: any[] = await (client as any).messaging.v1
        .services(profile.messagingServiceSid)
        .compliance.usa2p.list({ limit: 20 });

      // Pick the one that matches our stored campaignSid, or fall back to first
      const row =
        (profile.campaignSid && list.find((r: any) => r?.campaignSid === profile.campaignSid)) ||
        list[0];

      if (row) {
        details.campaignStatus = row.campaignStatus;
        details.campaignSid = row.campaignSid;
        if (!profile.campaignSid && row.campaignSid) {
          profile.campaignSid = row.campaignSid;
          changed = true;
        }

        const mapped = mapCampaignStatus(row.campaignStatus);
        if (mapped.stage && mapped.stage !== profile.registrationStatus) {
          profile.approvalHistory = profile.approvalHistory || [];
          profile.approvalHistory.push({ stage: mapped.stage, at: new Date(), note: "Campaign status update" });
          profile.registrationStatus = mapped.stage;
          changed = true;
        }

        // When VERIFIED, mark tenant as ready
        if (mapped.ready && !profile.messagingReady) {
          profile.messagingReady = true;
          // We also consider the lifecycle fully "ready"
          if (profile.registrationStatus !== "ready") {
            profile.approvalHistory = profile.approvalHistory || [];
            profile.approvalHistory.push({ stage: "ready", at: new Date(), note: "A2P verified & wired" });
            profile.registrationStatus = "ready";
          }
          changed = true;
          approvedNow = true;
        }
      }
    } catch (e: any) {
      profile.lastError = `Campaign fetch failed: ${e?.message || String(e)}`;
      changed = true;
    }
  }

  return { changed, approvedNow, details };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Optional secret check to prevent abuse
    if (CRON_SECRET) {
      const token = (req.query.token || req.headers["x-cron-token"]) as string | undefined;
      if (token !== CRON_SECRET) return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (!client) {
      return res.status(500).json({ ok: false, error: "Twilio credentials not configured" });
    }

    await dbConnect();

    // Only profiles not fully ready (or with recent errors)
    const profiles = await A2PProfile.find({
      $or: [{ registrationStatus: { $ne: "ready" } }, { messagingReady: { $ne: true } }, { lastError: { $exists: true, $ne: "" } }],
    });

    let updated = 0;
    let approved = 0;
    const results: Json[] = [];

    for (const profile of profiles) {
      const beforeReady = !!profile.messagingReady;
      const { changed, approvedNow, details } = await checkOne(profile as IA2PProfile);

      if (changed) {
        await profile.save();
        updated++;
      }

      // Fire "approved" email once, right when it flips to ready
      if (approvedNow && !beforeReady) {
        const user = await User.findById(profile.userId).lean();
        if (user?.email) {
          try {
            await sendA2PApprovedEmail({
              to: user.email,
              name: user.name || user.firstName || undefined,
            });
            approved++;
          } catch (e) {
            // swallow email failures; status has still been updated
            // optionally log e
          }
        }
      }

      results.push({
        userId: profile.userId,
        registrationStatus: profile.registrationStatus,
        messagingReady: profile.messagingReady,
        brandSid: profile.brandSid,
        campaignSid: profile.campaignSid,
        details,
        lastError: profile.lastError || undefined,
      });
    }

    return res.status(200).json({
      ok: true,
      checked: profiles.length,
      updated,
      approved,
      results,
    });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || "check-a2p failed" });
  }
}

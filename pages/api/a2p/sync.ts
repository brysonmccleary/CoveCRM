// pages/api/a2p/sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import User from "@/models/User";
import { sendA2PApprovedEmail, sendA2PDeclinedEmail } from "@/lib/a2p/notifications";

// Twilio client is optional in case env vars are not present
let twilioClient: any = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  // lazy import to avoid ESM problems during build
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const twilio = require("twilio");
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";

const APPROVED = new Set(["approved", "verified", "active", "in_use", "registered", "campaign_approved"]);
const DECLINED_MATCH = /(reject|denied|declined|failed|error)/i;

type AnyDoc = Record<string, any>;

function bool(v: any): boolean {
  return v === true || String(v).toLowerCase() === "true" || v === 1 || v === "1";
}

function classifyFromDoc(p: AnyDoc) {
  // Trust webhook / internal state if already marked approved
  const docState = String(p?.state || "").toLowerCase();
  const appStatus = String(p?.applicationStatus || "").toLowerCase();
  if (docState === "approved" || appStatus === "approved") {
    return { state: "approved" as const };
  }
  if (docState === "declined" || appStatus === "declined") {
    return { state: "declined" as const };
  }
  return { state: "pending" as const };
}

function listMissingSids(p: AnyDoc) {
  // Support either field naming: {campaignSid} or {usa2pSid}
  const required = [
    ["profileSid", p?.profileSid],
    ["brandSid", p?.brandSid],
    ["trustProductSid", p?.trustProductSid],
    ["campaignSid/usa2pSid", p?.campaignSid || p?.usa2pSid],
    ["messagingServiceSid", p?.messagingServiceSid],
  ] as const;
  return required.filter(([, v]) => !v).map(([k]) => k);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });
  if (CRON_SECRET && req.headers["x-cron-key"] !== CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await mongooseConnect();

  // Only sync ones that aren't fully live yet (or recently changed)
  const candidates: AnyDoc[] = await A2PProfile.find({
    $or: [
      { applicationStatus: { $in: [null, "pending"] } },
      { state: { $in: [null, "pending"] } },
      { messagingReady: { $ne: true } },
    ],
  })
    .limit(200)
    .lean();

  const results: AnyDoc[] = [];

  for (const doc of candidates) {
    const id = String(doc._id);
    const userId = doc.userId ? String(doc.userId) : null;

    // Normalize field names we might encounter
    const profileSid = doc.profileSid || null;
    const brandSid = doc.brandSid || null;
    const trustProductSid = doc.trustProductSid || null;
    const campaignSid = doc.campaignSid || doc.usa2pSid || null;
    const messagingServiceSid = doc.messagingServiceSid || null;

    const missing = listMissingSids(doc);
    const baseClass = classifyFromDoc(doc); // trust webhook if set

    // If already approved by webhook/state, mark ready and skip Twilio
    if (baseClass.state === "approved") {
      try {
        await A2PProfile.updateOne(
          { _id: doc._id },
          {
            $set: {
              messagingReady: true,
              applicationStatus: "approved",
              registrationStatus: doc.registrationStatus || "campaign_approved",
              lastSyncedAt: new Date(),
            },
            $unset: { lastError: 1 },
          }
        );

        // send email once
        if (!doc.approvalNotifiedAt) {
          const user = userId ? await User.findById(userId).lean() : null;
          if (user?.email) {
            try {
              await sendA2PApprovedEmail({
                to: user.email,
                name: user.name || undefined,
                dashboardUrl: `${BASE_URL}/settings/messaging`,
              });
              await A2PProfile.updateOne({ _id: doc._id }, { $set: { approvalNotifiedAt: new Date() } });
            } catch (e: any) {
              // keep syncing even if email fails
              await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastError: `notify: ${e?.message || e}` } });
            }
          }
        }
      } catch (e: any) {
        results.push({
          id,
          userId,
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          state: "error",
          error: e?.message || String(e),
          missing,
        });
        continue;
      }

      results.push({
        id,
        userId,
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        state: "approved",
        applicationStatus: "approved",
        registrationStatus: doc.registrationStatus || "campaign_approved",
        missing,
        lastSyncedAt: new Date().toISOString(),
      });
      continue;
    }

    // Otherwise, try to query Twilio if we can
    let brandStatus: string | undefined;
    let campStatus: string | undefined;

    try {
      if (twilioClient && brandSid) {
        const brand = await twilioClient.messaging.v1.brandRegistrations(brandSid).fetch();
        brandStatus = (brand as any)?.status || (brand as any)?.state;
      }
    } catch {
      // ignore: we still classify
    }

    try {
      if (twilioClient && campaignSid && messagingServiceSid) {
        const usA2p = await twilioClient.messaging.v1
          .services(messagingServiceSid)
          .usAppToPerson(campaignSid)
          .fetch();
        campStatus = (usA2p as any)?.status || (usA2p as any)?.state;
      }
    } catch {
      // ignore
    }

    const statusStrings = [brandStatus, campStatus].filter(Boolean).map((s) => String(s).toLowerCase());
    const isApproved = statusStrings.some((s) => APPROVED.has(s));
    const isDeclined = statusStrings.some((s) => DECLINED_MATCH.test(s));

    try {
      if (isApproved) {
        await A2PProfile.updateOne(
          { _id: doc._id },
          {
            $set: {
              messagingReady: true,
              applicationStatus: "approved",
              registrationStatus: statusStrings.some((s) => s === "campaign_approved" || s === "in_use" || s === "registered")
                ? "campaign_approved"
                : "ready",
              lastSyncedAt: new Date(),
            },
            $unset: { lastError: 1 },
          }
        );

        // notify once
        if (!doc.approvalNotifiedAt) {
          const user = userId ? await User.findById(userId).lean() : null;
          if (user?.email) {
            try {
              await sendA2PApprovedEmail({
                to: user.email,
                name: user.name || undefined,
                dashboardUrl: `${BASE_URL}/settings/messaging`,
              });
              await A2PProfile.updateOne({ _id: doc._id }, { $set: { approvalNotifiedAt: new Date() } });
            } catch (e: any) {
              await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastError: `notify: ${e?.message || e}` } });
            }
          }
        }

        results.push({
          id,
          userId,
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          state: "approved",
          brandStatus: brandStatus || null,
          campaignStatus: campStatus || null,
          missing,
          lastSyncedAt: new Date().toISOString(),
        });
        continue;
      }

      if (isDeclined) {
        await A2PProfile.updateOne(
          { _id: doc._id },
          {
            $set: {
              messagingReady: false,
              applicationStatus: "declined",
              registrationStatus: "rejected",
              lastSyncedAt: new Date(),
            },
          }
        );

        // notify (best effort)
        const user = userId ? await User.findById(userId).lean() : null;
        if (user?.email) {
          try {
            await sendA2PDeclinedEmail({
              to: user.email,
              name: user.name || undefined,
              reason: doc.declinedReason || "Declined by reviewers",
              helpUrl: `${BASE_URL}/help/a2p-checklist`,
            });
          } catch (e: any) {
            await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastError: `notify: ${e?.message || e}` } });
          }
        }

        results.push({
          id,
          userId,
          profileSid,
          brandSid,
          trustProductSid,
          campaignSid,
          messagingServiceSid,
          state: "declined",
          brandStatus: brandStatus || null,
          campaignStatus: campStatus || null,
          missing,
          lastSyncedAt: new Date().toISOString(),
        });
        continue;
      }

      // Still pending
      await A2PProfile.updateOne({ _id: doc._id }, { $set: { lastSyncedAt: new Date() } });

      results.push({
        id,
        userId,
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        state: "pending",
        brandStatus: brandStatus || null,
        campaignStatus: campStatus || null,
        missing,
        lastSyncedAt: new Date().toISOString(),
      });
    } catch (e: any) {
      results.push({
        id,
        userId,
        profileSid,
        brandSid,
        trustProductSid,
        campaignSid,
        messagingServiceSid,
        state: "error",
        error: e?.message || String(e),
        missing,
      });
    }
  }

  return res.status(200).json({ ok: true, checked: results.length, results });
}

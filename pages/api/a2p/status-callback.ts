// pages/api/a2p/status-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import twilio from "twilio";
import {
  sendA2PApprovedEmail,
  sendA2PDeclinedEmail,
} from "@/lib/a2p/notifications";

// Use Next's default body parser so x-www-form-urlencoded comes in as req.body
export const config = { api: { bodyParser: true } };

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const HAS_TWILIO = Boolean(process.env.TWILIO_ACCOUNT_SID) && Boolean(process.env.TWILIO_AUTH_TOKEN);
const client = HAS_TWILIO ? twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!) : null;

const APPROVED = new Set(["approved", "verified", "active", "in_use", "registered", "campaign_approved"]);
const DECLINED_MATCH = /(reject|rejected|deny|denied|fail|failed|decline|declined|error)/i;

// ---------- helpers ----------------------------------------------------------

function toObjectFromMaybeString(body: any): Record<string, any> {
  if (body && typeof body === "object") return body as Record<string, any>;
  if (typeof body === "string") {
    try { const j = JSON.parse(body); if (j && typeof j === "object") return j; } catch {}
    try {
      const params = new URLSearchParams(body);
      const obj: Record<string, any> = {};
      for (const [k, v] of params.entries()) obj[k] = v;
      if (Object.keys(obj).length) return obj;
    } catch {}
  }
  return {};
}

function pickAnySid(body: Record<string, any>): string | undefined {
  const keys = ["ObjectSid","ResourceSid","customerProfileSid","trustProductSid","brandSid","campaignSid","usa2pSid","messagingServiceSid"];
  for (const k of keys) {
    const v = body[k] ?? body[k.toLowerCase()];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickStatus(body: Record<string, any>): string {
  const s = body.Status ?? body.status ?? body.EventType ?? body.eventtype ?? body.Event ?? body.event ?? "";
  return String(s).toLowerCase();
}

async function ensureTenantMessagingService(userId: string, friendlyNameHint?: string): Promise<string | null> {
  if (!HAS_TWILIO || !client) return null;
  const a2p = await A2PProfile.findOne({ userId }).lean();
  if (a2p?.messagingServiceSid) {
    await client.messaging.v1.services(a2p.messagingServiceSid).update({
      friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
      inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
    });
    return a2p.messagingServiceSid;
  }
  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: `${BASE_URL}/api/twilio/status-callback`,
  });
  await A2PProfile.updateOne({ userId }, { $set: { messagingServiceSid: svc.sid } }, { upsert: false });
  return svc.sid;
}

async function addNumberToMessagingService(serviceSid: string, numberSid: string) {
  if (!HAS_TWILIO || !client) return;
  try {
    await client.messaging.v1.services(serviceSid).phoneNumbers.create({ phoneNumberSid: numberSid });
  } catch (err: any) {
    if (err?.code === 21712) {
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) { try { await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove(); } catch {} }
      await client.messaging.v1.services(serviceSid).phoneNumbers.create({ phoneNumberSid: numberSid });
    } else {
      throw err;
    }
  }
}

// ---------- handler ----------------------------------------------------------

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    await mongooseConnect();

    const body = toObjectFromMaybeString((req as any).body);
    const anySid = pickAnySid(body);
    const statusRaw = pickStatus(body);
    const reason = body.Reason || body.reason || body.Error || "";

    // Debug echo (no writes)
    if (String(req.query.debug) === "1") {
      return res.status(200).json({ ok: true, parsed: body, anySid, statusRaw, hasTwilio: HAS_TWILIO });
    }

    if (!anySid) return res.status(200).json({ ok: true });

    const a2p = await A2PProfile.findOne({
      $or: [
        { profileSid: anySid },
        { trustProductSid: anySid },
        { brandSid: anySid },
        { campaignSid: anySid },
        { usa2pSid: anySid },
        { messagingServiceSid: anySid },
      ],
    }).lean();
    if (!a2p) {
      const explicitCampaign = body.campaignSid || body.campaignsid || body.ResourceSid || body.resourcesid;
      if (explicitCampaign) {
        await A2PProfile.updateOne({ campaignSid: explicitCampaign }, { $set: { lastSyncedAt: new Date() } });
      }
      return res.status(200).json({ ok: true });
    }

    // ---------------- APPROVED FLOW ----------------
    if (statusRaw && (APPROVED.has(statusRaw) || statusRaw.includes("approved"))) {
      // Twilio side-effects (never block)
      try {
        const user = await User.findById(a2p.userId).lean();
        if (user) {
          const msSid = await ensureTenantMessagingService(String(user._id), user.name || user.email);
          if (msSid) {
            const owned = await PhoneNumber.find({ userId: user._id }).lean();
            for (const num of owned) {
              const numSid = (num as any).twilioSid as string | undefined;
              if (!numSid) continue;
              try { await addNumberToMessagingService(msSid, numSid); } catch {}
            }
          }
        }
      } catch (twerr) {
        console.warn("Twilio side-effects failed (ignored):", (twerr as any)?.message || twerr);
      }

      // Persist approval via updateOne (bypass validation)
      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: true,
            applicationStatus: "approved",
            declinedReason: undefined,
            registrationStatus:
              a2p.registrationStatus === "brand_submitted"
                ? "brand_approved"
                : a2p.registrationStatus === "campaign_submitted"
                ? "campaign_approved"
                : "ready",
            lastSyncedAt: new Date(),
          },
          $push: { approvalHistory: { stage: "campaign_approved", at: new Date() } },
          $setOnInsert: {},
        }
      );

      // Notify once (best effort, never blocks)
      if (!a2p.approvalNotifiedAt) {
        try {
          const user2 = await User.findById(a2p.userId).lean();
          if (user2?.email) {
            await sendA2PApprovedEmail({
              to: user2.email,
              name: user2.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
          }
          await A2PProfile.updateOne({ _id: a2p._id }, { $set: { approvalNotifiedAt: new Date() } });
        } catch (e) {
          console.warn("A2P approved email failed (ignored):", (e as any)?.message || e);
        }
      }

      return res.status(200).json({ ok: true, messagingReady: true });
    }

    // ---------------- DECLINED FLOW ----------------
    if (statusRaw && DECLINED_MATCH.test(statusRaw)) {
      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: false,
            registrationStatus: "rejected",
            applicationStatus: "declined",
            declinedReason: reason || "Rejected by reviewers",
            lastSyncedAt: new Date(),
          },
          $push: { approvalHistory: { stage: "rejected", at: new Date(), note: reason || "Rejected by reviewers" } },
        }
      );

      // Best-effort notify
      try {
        const user = await User.findById(a2p.userId).lean();
        if (user?.email) {
          await sendA2PDeclinedEmail({
            to: user.email,
            name: user.name || undefined,
            reason: reason || "Rejected by reviewers",
            helpUrl: `${BASE_URL}/help/a2p-checklist`,
          });
        }
      } catch (e) {
        console.warn("A2P declined email failed (ignored):", (e as any)?.message || e);
      }

      return res.status(200).json({ ok: true, messagingReady: false });
    }

    // Intermediate/unknown → just record activity (no validation)
    await A2PProfile.updateOne({ _id: a2p._id }, { $set: { lastSyncedAt: new Date() } });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("A2P status-callback error:", err);
    return res.status(200).json({ ok: true });
  }
}

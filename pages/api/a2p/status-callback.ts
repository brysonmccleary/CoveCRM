// pages/api/a2p/status-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { buffer } from "micro";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import twilio from "twilio";
import {
  sendA2PApprovedEmail,
  sendA2PDeclinedEmail,
} from "@/lib/a2p/notifications";

export const config = {
  api: { bodyParser: false },
};

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

const APPROVED = new Set(["approved", "verified", "active", "in_use", "registered", "campaign_approved"]);
const DECLINED_MATCH = /(reject|rejected|deny|denied|fail|failed|decline|declined|error)/i;

// ---------- helpers ----------------------------------------------------------

async function parseIncomingBody(req: NextApiRequest): Promise<Record<string, any>> {
  const raw = await buffer(req);
  const ctype = (req.headers["content-type"] || "").toLowerCase();

  // If raw is empty (some runtimes pre-consume the stream), trust req.body
  if (!raw?.length && (req as any).body && typeof (req as any).body === "object") {
    return (req as any).body as Record<string, any>;
  }

  // Handle form-encoded (Twilio default)
  if (ctype.includes("application/x-www-form-urlencoded") || ctype.includes("multipart/form-data")) {
    const params = new URLSearchParams(raw.toString("utf8"));
    const obj: Record<string, any> = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  }

  // Handle JSON
  if (ctype.includes("application/json")) {
    try {
      return JSON.parse(raw.toString("utf8") || "{}");
    } catch {
      return {};
    }
  }

  // Fallback: try to parse as querystring
  try {
    const params = new URLSearchParams(raw.toString("utf8"));
    const obj: Record<string, any> = {};
    for (const [k, v] of params.entries()) obj[k] = v;
    return obj;
  } catch {
    return {};
  }
}

function pickAnySid(body: Record<string, any>): string | undefined {
  const keys = [
    "ObjectSid",
    "ResourceSid",
    "customerProfileSid",
    "trustProductSid",
    "brandSid",
    "campaignSid",
    "usa2pSid",
    "messagingServiceSid",
  ];
  for (const k of keys) {
    const v = body[k] ?? body[k.toLowerCase()];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return undefined;
}

function pickStatus(body: Record<string, any>): string {
  // Prefer explicit Status/status; fall back to EventType
  const s =
    body.Status ??
    body.status ??
    body.EventType ??
    body.eventtype ??
    body.Event ??
    body.event ??
    "";
  return String(s).toLowerCase();
}

async function ensureTenantMessagingService(userId: string, friendlyNameHint?: string): Promise<string> {
  let a2p = await A2PProfile.findOne({ userId });
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
  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  } else {
    await A2PProfile.updateOne({ userId }, { $set: { messagingServiceSid: svc.sid } });
  }
  return svc.sid;
}

async function addNumberToMessagingService(serviceSid: string, numberSid: string) {
  try {
    await client.messaging.v1.services(serviceSid).phoneNumbers.create({ phoneNumberSid: numberSid });
  } catch (err: any) {
    if (err?.code === 21712) {
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try { await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove(); } catch {}
      }
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

    const body = await parseIncomingBody(req);
    const anySid = pickAnySid(body);

    if (!anySid) {
      // No SID → do nothing but 200 to avoid Twilio retry storms
      return res.status(200).json({ ok: true });
    }

    const a2p = await A2PProfile.findOne({
      $or: [
        { profileSid: anySid },
        { trustProductSid: anySid },
        { brandSid: anySid },
        { campaignSid: anySid },
        { usa2pSid: anySid },
        { messagingServiceSid: anySid },
      ],
    });

    if (!a2p) {
      // If Twilio explicitly sent a campaignSid, bump lastSyncedAt for any that match it.
      const explicitCampaign = body.campaignSid || body.campaignsid || body.ResourceSid || body.resourcesid;
      if (explicitCampaign) {
        await A2PProfile.updateOne(
          { campaignSid: explicitCampaign },
          { $set: { lastSyncedAt: new Date() } }
        );
      }
      return res.status(200).json({ ok: true });
    }

    const statusRaw = pickStatus(body); // <- NEW robust status extraction
    const reason = body.Reason || body.reason || body.Error || "";

    // APPROVED FLOW
    if (statusRaw && (APPROVED.has(statusRaw) || statusRaw.includes("approved"))) {
      const user = await User.findById(a2p.userId);
      if (user) {
        const msSid = await ensureTenantMessagingService(String(user._id), user.name || user.email);
        const owned = await PhoneNumber.find({ userId: user._id });
        for (const num of owned) {
          const numSid = (num as any).twilioSid as string | undefined;
          if (!numSid) continue;
          try {
            await addNumberToMessagingService(msSid, numSid);
            if ((num as any).messagingServiceSid !== msSid) {
              (num as any).messagingServiceSid = msSid;
              await (num as any).save();
            }
          } catch (e) {
            console.warn(`Attach failed for ${num.phoneNumber} → ${msSid}:`, e);
          }
        }
      }

      a2p.messagingReady = true;
      a2p.applicationStatus = "approved";
      a2p.declinedReason = undefined;
      a2p.approvalHistory = [
        ...(a2p.approvalHistory || []),
        { stage: "campaign_approved", at: new Date() },
      ];
      a2p.registrationStatus =
        a2p.registrationStatus === "brand_submitted"
          ? "brand_approved"
          : a2p.registrationStatus === "campaign_submitted"
          ? "campaign_approved"
          : "ready";
      a2p.lastSyncedAt = new Date();

      if (!a2p.approvalNotifiedAt) {
        try {
          const user2 = await User.findById(a2p.userId);
          if (user2?.email) {
            await sendA2PApprovedEmail({
              to: user2.email,
              name: user2.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
          }
          a2p.approvalNotifiedAt = new Date();
        } catch (e) {
          console.warn("A2P approved email failed:", (e as any)?.message || e);
        }
      }

      await a2p.save();
      return res.status(200).json({ ok: true, messagingReady: true });
    }

    // DECLINED FLOW
    if (statusRaw && DECLINED_MATCH.test(statusRaw)) {
      a2p.messagingReady = false;
      a2p.registrationStatus = "rejected";
      a2p.applicationStatus = "declined";
      a2p.declinedReason = reason || "Rejected by reviewers";
      a2p.approvalHistory = [
        ...(a2p.approvalHistory || []),
        { stage: "rejected", at: new Date(), note: a2p.declinedReason },
      ];
      a2p.lastSyncedAt = new Date();

      try {
        const user = await User.findById(a2p.userId);
        if (user?.email) {
          await sendA2PDeclinedEmail({
            to: user.email,
            name: user.name || undefined,
            reason: a2p.declinedReason,
            helpUrl: `${BASE_URL}/help/a2p-checklist`,
          });
        }
      } catch (e) {
        console.warn("A2P declined email failed:", (e as any)?.message || e);
      }

      await a2p.save();
      return res.status(200).json({ ok: true, messagingReady: false });
    }

    // Intermediate/unknown → just record activity
    a2p.lastSyncedAt = new Date();
    await a2p.save();
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("A2P status-callback error:", err);
    return res.status(200).json({ ok: true });
  }
}

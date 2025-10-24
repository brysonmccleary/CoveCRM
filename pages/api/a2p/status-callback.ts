// pages/api/a2p/status-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import twilio from "twilio";

// reuse your platform creds for mgmt events
const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

// ✅ notifications shim
import {
  sendA2PApprovedEmail,
  sendA2PDeclinedEmail,
} from "@/lib/a2p/notifications";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

const APPROVED = new Set(["approved","verified","active","in_use","registered"]);
const DECLINED_MATCH = /(reject|denied|failed)/i;

/** Ensure tenant Messaging Service exists & is webhook-configured. Returns SID. */
async function ensureTenantMessagingService(userId: string, friendlyNameHint?: string): Promise<string> {
  const a2p = await A2PProfile.findOne({ userId }, { messagingServiceSid: 1 }).lean();
  if (a2p?.messagingServiceSid) {
    try {
      await client.messaging.v1.services(a2p.messagingServiceSid).update({
        friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
        inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
        statusCallback: `${BASE_URL}/api/twilio/status-callback`,
      });
    } catch {}
    return a2p.messagingServiceSid;
  }

  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: `${BASE_URL}/api/twilio/status-callback`,
  });

  await A2PProfile.updateOne(
    { userId },
    { $set: { messagingServiceSid: svc.sid } },
    { upsert: true }
  );

  return svc.sid;
}

/** Add a number to a Messaging Service sender pool. Handles 21712 (unlink/reattach). */
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    await mongooseConnect();

    // Twilio posts application/x-www-form-urlencoded; Next exposes as req.body object
    const body: any = req.body || {};

    const anySid: string | undefined =
      body.ObjectSid || body.ResourceSid || body.customerProfileSid ||
      body.trustProductSid || body.brandSid || body.campaignSid || body.messagingServiceSid;

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
    if (!a2p) return res.status(200).json({ ok: true });

    const statusRaw = String(body.Status || body.status || "").toLowerCase();
    const reason = body.Reason || body.reason || body.Error || "";

    // APPROVED FLOW
    if (statusRaw && APPROVED.has(statusRaw)) {
      const user = await User.findById(a2p.userId).lean();
      if (user) {
        const msSid = await ensureTenantMessagingService(String(user._id), user.name || user.email);

        // attach all owned numbers (idempotent)
        const owned = await PhoneNumber.find({ userId: user._id }, { twilioSid: 1, phoneNumber: 1 }).lean();
        for (const num of owned) {
          const numSid = (num as any).twilioSid as string | undefined;
          if (!numSid) continue;
          try {
            await addNumberToMessagingService(msSid, numSid);
            // update PhoneNumber doc without triggering validation
            await PhoneNumber.updateOne(
              { _id: (num as any)._id },
              { $set: { messagingServiceSid: msSid } }
            );
          } catch (e) {
            console.warn(`Attach failed for ${(num as any).phoneNumber} → ${msSid}:`, e);
          }
        }
      }

      const now = new Date();

      // update A2PProfile (targeted write, no full validation)
      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: true,
            applicationStatus: "approved",
            declinedReason: undefined,
            registrationStatus:
              a2p.registrationStatus === "brand_submitted" ? "brand_approved" :
              a2p.registrationStatus === "campaign_submitted" ? "campaign_approved" :
              "ready",
            lastSyncedAt: now,
            updatedAt: now,
          },
          $push: {
            approvalHistory: { stage: "campaign_approved", at: now },
          },
        }
      );

      // notify once
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
          await A2PProfile.updateOne(
            { _id: a2p._id },
            { $set: { approvalNotifiedAt: new Date() } }
          );
        } catch (e) {
          console.warn("A2P approved email failed:", (e as any)?.message || e);
        }
      }

      return res.status(200).json({ ok: true, messagingReady: true });
    }

    // DECLINED / FAILED FLOW
    if (DECLINED_MATCH.test(statusRaw)) {
      const now = new Date();
      const declinedReason = reason || "Rejected by reviewers";

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: false,
            registrationStatus: "rejected",
            applicationStatus: "declined",
            declinedReason,
            lastSyncedAt: now,
            updatedAt: now,
          },
          $push: {
            approvalHistory: { stage: "rejected", at: now, note: declinedReason },
          },
        }
      );

      // notify (no throttle—Twilio typically sends one terminal event)
      try {
        const user = await User.findById(a2p.userId).lean();
        if (user?.email) {
          await sendA2PDeclinedEmail({
            to: user.email,
            name: user.name || undefined,
            reason: declinedReason,
            helpUrl: `${BASE_URL}/help/a2p-checklist`,
          });
        }
      } catch (e) {
        console.warn("A2P declined email failed:", (e as any)?.message || e);
      }

      return res.status(200).json({ ok: true, messagingReady: false });
    }

    // Intermediate/update states — just refresh lastSyncedAt without validating doc
    await A2PProfile.updateOne(
      { _id: a2p._id },
      { $set: { lastSyncedAt: new Date(), updatedAt: new Date() } }
    );
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("A2P status-callback error:", err);
    // Always 200 to avoid Twilio retry storms
    return res.status(200).json({ ok: true });
  }
}

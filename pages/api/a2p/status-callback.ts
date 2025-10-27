// /pages/api/a2p/status-callback.ts
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

const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");

const APPROVED = new Set(["approved","verified","active","in_use","registered","campaign_approved"]);
const DECLINED_MATCH = /(reject|denied|declined|failed|error)/i;

const lc = (v: any) => (typeof v === "string" ? v.toLowerCase() : String(v ?? "").toLowerCase());

/** Ensure Messaging Service exists for THIS profile. Uses updateOne (no .save / no validation). */
async function ensureTenantMessagingServiceForProfile(a2pId: string, userLabel: string | undefined, existingMsSid?: string) {
  if (existingMsSid) {
    await client.messaging.v1.services(existingMsSid).update({
      friendlyName: `CoveCRM – ${userLabel || a2pId}`,
      inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
    });
    return existingMsSid;
  }
  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${userLabel || a2pId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: `${BASE_URL}/api/twilio/status-callback`,
  });
  await A2PProfile.updateOne({ _id: a2pId }, { $set: { messagingServiceSid: svc.sid } }); // no validation
  return svc.sid;
}

/** Add number to a Messaging Service. Handles 21712 unlink/reattach. */
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

  const debugEnabled = String(req.query.debug ?? "") === "1";
  const debug: Record<string, any> = {
    hasTwilio: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  };

  try {
    await mongooseConnect();

    const body: any = req.body || {};
    const statusRaw = lc(body.Status || body.status || "");
    const eventType = String(body.EventType || body.Event || body.Type || "");
    const anySid: string | undefined =
      body.ObjectSid || body.ResourceSid || body.customerProfileSid ||
      body.trustProductSid || body.brandSid || body.campaignSid || body.messagingServiceSid;

    if (debugEnabled) {
      debug.parsed = {
        ...(body.Status ? { Status: body.Status } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(eventType ? { EventType: eventType } : {}),
        ...(anySid ? { anySid } : {}),
        ...(body.campaignSid ? { campaignSid: body.campaignSid } : {}),
        ...(body.messagingServiceSid ? { messagingServiceSid: body.messagingServiceSid } : {}),
        ...(body.brandSid ? { brandSid: body.brandSid } : {}),
        ...(body.ResourceSid ? { ResourceSid: body.ResourceSid } : {}),
      };
      debug.statusRaw = statusRaw;
    }

    if (!anySid) {
      return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });
    }

    // Find the existing A2P profile by any SID we recognize
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
      return res.status(200).json({ ok: true, ...(debugEnabled ? { debug } : {}) });
    }

    // === APPROVED ===
    if (statusRaw && APPROVED.has(statusRaw)) {
      try {
        const user = a2p.userId ? await User.findById(a2p.userId).lean() : null;
        const msSid = await ensureTenantMessagingServiceForProfile(
          String(a2p._id),
          user?.name || user?.email,
          a2p.messagingServiceSid
        );

        // Attach all owned numbers (best effort)
        if (user?._id && msSid) {
          const owned = await PhoneNumber.find({ userId: user._id }).lean();
          for (const num of owned) {
            const numSid = (num as any).twilioSid as string | undefined;
            if (!numSid) continue;
            try {
              await addNumberToMessagingService(msSid, numSid);
              if ((num as any).messagingServiceSid !== msSid) {
                await PhoneNumber.updateOne({ _id: (num as any)._id }, { $set: { messagingServiceSid: msSid } });
              }
            } catch (e) {
              console.warn(`Attach failed for ${num.phoneNumber} → ${msSid}:`, e);
            }
          }
        }
      } catch (e) {
        console.warn("MS ensure/attach failed (non-fatal):", (e as any)?.message || e);
      }

      // Flip flags WITHOUT validation
      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: true,
            applicationStatus: "approved",
            registrationStatus:
              a2p.registrationStatus === "brand_submitted" ? "brand_approved" :
              a2p.registrationStatus === "campaign_submitted" ? "campaign_approved" :
              "ready",
            lastSyncedAt: new Date(),
          },
          $unset: { lastError: 1, declinedReason: 1 },
          $push: { approvalHistory: { stage: "campaign_approved", at: new Date() } },
        }
      );

      // Notify once (best effort)
      try {
        if (!a2p.approvalNotifiedAt) {
          const user2 = a2p.userId ? await User.findById(a2p.userId).lean() : null;
          if (user2?.email) {
            await sendA2PApprovedEmail({
              to: user2.email,
              name: user2.name || undefined,
              dashboardUrl: `${BASE_URL}/settings/messaging`,
            });
          }
          await A2PProfile.updateOne({ _id: a2p._id }, { $set: { approvalNotifiedAt: new Date() } });
        }
      } catch (e) {
        console.warn("A2P approved email failed:", (e as any)?.message || e);
        await A2PProfile.updateOne({ _id: a2p._id }, { $set: { lastError: `notify: ${(e as any)?.message || e}` } });
      }

      const payload: any = { ok: true, messagingReady: true };
      if (debugEnabled) payload.debug = debug;
      return res.status(200).json(payload);
    }

    // === DECLINED / FAILED ===
    if (DECLINED_MATCH.test(statusRaw)) {
      const declinedReason = String(body.Reason || body.reason || body.Error || "Rejected by reviewers");

      await A2PProfile.updateOne(
        { _id: a2p._id },
        {
          $set: {
            messagingReady: false,
            applicationStatus: "declined",
            registrationStatus: "rejected",
            declinedReason,
            lastSyncedAt: new Date(),
          },
          $push: { approvalHistory: { stage: "rejected", at: new Date(), note: declinedReason } },
        }
      );

      try {
        const user = a2p.userId ? await User.findById(a2p.userId).lean() : null;
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
        await A2PProfile.updateOne({ _id: a2p._id }, { $set: { lastError: `notify: ${(e as any)?.message || e}` } });
      }

      const payload: any = { ok: true, messagingReady: false };
      if (debugEnabled) payload.debug = debug;
      return res.status(200).json(payload);
    }

    // === INTERMEDIATE ===
    await A2PProfile.updateOne({ _id: a2p._id }, { $set: { lastSyncedAt: new Date() } });
    const payload: any = { ok: true };
    if (debugEnabled) payload.debug = debug;
    return res.status(200).json(payload);
  } catch (err) {
    console.error("A2P status-callback error:", err);
    const payload: any = { ok: true, error: (err as any)?.message || String(err) };
    if (debugEnabled) payload.debug = debug;
    return res.status(200).json(payload);
  }
}

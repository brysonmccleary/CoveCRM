// pages/api/a2p/status-callback.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import User from "@/models/User";
import twilioClient from "@/lib/twilioClient";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "";

const APPROVED = new Set(["approved", "verified", "active", "in_use", "registered"]);

/** Ensure tenant Messaging Service exists & is webhook-configured. Returns SID. */
async function ensureTenantMessagingService(userId: string, friendlyNameHint?: string) {
  let a2p = await A2PProfile.findOne({ userId });

  if (a2p?.messagingServiceSid) {
    await twilioClient.messaging.v1.services(a2p.messagingServiceSid).update({
      friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
      inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
      statusCallback: `${BASE_URL}/api/twilio/status-callback`,
    });
    return a2p.messagingServiceSid;
  }

  const svc = await twilioClient.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyNameHint || userId}`,
    inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
    statusCallback: `${BASE_URL}/api/twilio/status-callback`,
  });

  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  } else {
    await A2PProfile.create({ userId, messagingServiceSid: svc.sid });
  }

  return svc.sid;
}

/** Add a number to a Messaging Service sender pool. Handles 21712 (unlink/reattach). */
async function addNumberToMessagingService(serviceSid: string, numberSid: string) {
  try {
    await twilioClient.messaging.v1.services(serviceSid).phoneNumbers.create({
      phoneNumberSid: numberSid,
    });
  } catch (err: any) {
    if (err?.code === 21712) {
      const services = await twilioClient.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try {
          await twilioClient.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
        } catch {
          // not linked here, ignore
        }
      }
      await twilioClient.messaging.v1.services(serviceSid).phoneNumbers.create({
        phoneNumberSid: numberSid,
      });
    } else {
      throw err;
    }
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");
  try {
    await mongooseConnect();

    // Twilio often posts application/x-www-form-urlencoded; Next parses it into req.body.
    const body: any = req.body || {};

    // Twilio may include various SID fields depending on the object changing.
    const anySid: string | undefined =
      body.ObjectSid ||
      body.ResourceSid ||
      body.customerProfileSid ||
      body.trustProductSid ||
      body.brandSid ||
      body.campaignSid ||
      body.messagingServiceSid;

    if (!anySid) {
      // Nothing we can map — acknowledge to avoid retry storms.
      return res.status(200).json({ ok: true });
    }

    // Find the tenant A2PProfile linked to this event.
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
      // Not for a tenant we know; acknowledge.
      return res.status(200).json({ ok: true });
    }

    const statusRaw = String(body.Status || body.status || "").toLowerCase();
    const reason = body.Reason || body.reason;

    // If this is an approval event, make the tenant fully ready.
    if (statusRaw && APPROVED.has(statusRaw)) {
      const user = await User.findById(a2p.userId);
      if (user) {
        // Ensure/create tenant Messaging Service and attach ALL owned numbers
        const msSid = await ensureTenantMessagingService(String(user._id), user.name || user.email);

        // Fetch all numbers owned by this user and attach them to the tenant MS
        const owned = await PhoneNumber.find({ userId: user._id });
        for (const num of owned) {
          try {
            await addNumberToMessagingService(msSid, num.twilioSid);
            if (num.messagingServiceSid !== msSid) {
              num.messagingServiceSid = msSid;
              await num.save();
            }
          } catch (e) {
            console.warn(`Failed to attach ${num.phoneNumber} to ${msSid}:`, e);
          }
        }
      }

      // Flip flags so sending is unblocked
      a2p.messagingReady = true;
      // Track coarse registration status
      if (a2p.registrationStatus === "brand_submitted") a2p.registrationStatus = "brand_approved";
      if (a2p.registrationStatus === "campaign_submitted") a2p.registrationStatus = "campaign_approved";
      await a2p.save();

      return res.status(200).json({ ok: true, messagingReady: true });
    }

    // If this looks like a rejection/failed state, record it
    if (statusRaw.includes("reject") || statusRaw.includes("failed") || statusRaw.includes("denied")) {
      a2p.messagingReady = false;
      a2p.registrationStatus = "rejected";
      (a2p as any).lastError = reason || "Rejected by reviewers";
      await a2p.save();
      return res.status(200).json({ ok: true, messagingReady: false });
    }

    // For intermediate states, just acknowledge
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("A2P status-callback error:", err);
    // Always 200 so Twilio doesn't hammer retries
    return res.status(200).json({ ok: true });
  }
}

// Optional: disable Next's default body parser if you plan to verify Twilio signatures manually.
// export const config = {
//   api: {
//     bodyParser: true, // default; set to false if you want raw body for signature verification
//   },
// };

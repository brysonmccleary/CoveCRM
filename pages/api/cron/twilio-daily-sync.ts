// /pages/api/cron/twilio-daily-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { getPlatformTwilioClient } from "@/lib/twilio/getPlatformClient";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);
const INBOUND_WEBHOOK = BASE_URL ? `${BASE_URL}/api/twilio/inbound-sms` : undefined;
const SHARED_MSID = process.env.TWILIO_MESSAGING_SERVICE_SID || "";

async function ensureServiceHooks(client: any, msid: string) {
  if (!msid || !INBOUND_WEBHOOK) return;
  try {
    await client.messaging.v1.services(msid).update({
      inboundRequestUrl: INBOUND_WEBHOOK,
      inboundMethod: "POST",
      statusCallback: STATUS_CALLBACK,
    });
  } catch (e) {
    console.warn("ensureServiceHooks failed:", (e as any)?.message || e);
  }
}

async function createTenantService(client: any, friendlyName: string) {
  if (!INBOUND_WEBHOOK) throw new Error("BASE_URL missing; cannot create Messaging Service.");
  const svc = await client.messaging.v1.services.create({
    friendlyName,
    inboundRequestUrl: INBOUND_WEBHOOK,
    inboundMethod: "POST",
    statusCallback: STATUS_CALLBACK,
  });
  return svc?.sid as string;
}

async function findIncomingNumberSid(client: any, phoneNumber: string) {
  // Exact match first (fast)
  const exact = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (exact?.[0]?.sid) return exact[0].sid;

  // Fallback: scan a page (enough for most accounts; can paginate later if needed)
  const normalizedDigits = (phoneNumber || "").replace(/[^\d]/g, "");
  const page = await client.incomingPhoneNumbers.list({ limit: 1000 });
  const match = page.find((n: any) => (n.phoneNumber || "").replace(/[^\d]/g, "") === normalizedDigits);
  return match?.sid || null;
}

async function attachNumberToService(client: any, msid: string, phoneNumber: string) {
  if (!msid || !phoneNumber) return { attached: false, reason: "missing-data" };
  const numSid = await findIncomingNumberSid(client, phoneNumber);
  if (!numSid) return { attached: false, reason: "number-not-found" };

  const attachedList = await client.messaging.v1.services(msid).phoneNumbers.list({ limit: 1000 });
  const already = attachedList.some((p: any) => p.phoneNumberSid === numSid);
  if (already) return { attached: false, reason: "already-attached" };

  await client.messaging.v1.services(msid).phoneNumbers.create({ phoneNumberSid: numSid });
  console.log(`🔗 Attached ${phoneNumber} (sid=${numSid}) -> ${msid}`);
  return { attached: true };
}

async function upsertUserA2P(userId: string, msid: string) {
  // Write to User.a2p
  await User.updateOne(
    { _id: userId },
    { $set: { "a2p.messagingServiceSid": msid }, $setOnInsert: { "a2p.messagingReady": false } },
    { upsert: false },
  ).exec();

  // Legacy compatibility: A2PProfile row
  const legacy = await A2PProfile.findOne({ userId });
  if (legacy) {
    if (!legacy.messagingServiceSid) {
      legacy.messagingServiceSid = msid;
      await legacy.save();
    }
  } else {
    await A2PProfile.create({ userId, messagingServiceSid: msid, messagingReady: false });
  }
}

/**
 * Auth:
 *  - Preferred: Authorization: Bearer <VERCEL_CRON_SECRET>
 *  - Also accepts: x-vercel-cron header (Vercel Cron)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const secret = process.env.VERCEL_CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  const hasBearer = !!secret && authHeader === `Bearer ${secret}`;
  const isVercelCron = !!req.headers["x-vercel-cron"];
  if (!hasBearer && !isVercelCron) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const client = getPlatformTwilioClient();

    const users = await User.find({})
      .select({ email: 1, name: 1, numbers: 1, a2p: 1 })
      .lean();

    let usersChecked = 0;
    let servicesTouched = 0;
    let servicesCreated = 0;
    let numbersAttached = 0;

    const details: any[] = [];

    for (const u of users) {
      usersChecked++;
      const userId = String((u as any)._id);
      const email = (u as any).email;

      const numbers: any[] = Array.isArray((u as any).numbers) ? (u as any).numbers : [];
      const userHasNumbers = numbers.some(n => !!n?.phoneNumber);

      // Determine the service, with auto-create when needed
      const legacy = await A2PProfile.findOne({ userId }).lean();
      let defaultMsid =
        (u as any).a2p?.messagingServiceSid ||
        legacy?.messagingServiceSid ||
        SHARED_MSID ||
        "";

      if (!defaultMsid && userHasNumbers) {
        try {
          const friendly = `CoveCRM – ${u.name || email || userId}`;
          defaultMsid = await createTenantService(client, friendly);
          servicesCreated++;
          details.push({ user: email, msid: defaultMsid, action: "created-msid" });
          await upsertUserA2P(userId, defaultMsid);
        } catch (e) {
          const msg = (e as any)?.message || String(e);
          console.warn(`Failed to create Messaging Service for ${email}:`, msg);
          details.push({ user: email, msid: null, action: "create-msid-failed", error: msg });
          // continue; we’ll skip attaching numbers for this user if no msid
        }
      }

      // If no msid (and possibly no numbers), skip — first outbound send can still create one
      if (!defaultMsid) {
        details.push({ user: email, msid: null, action: "skipped-no-service" });
        continue;
      }

      await ensureServiceHooks(client, defaultMsid);
      servicesTouched++;

      // Attach each number to the right service (per-number override wins)
      for (const n of numbers) {
        const phone = n?.phoneNumber;
        if (!phone) continue;

        const targetMsid = n?.messagingServiceSid || defaultMsid;

        await ensureServiceHooks(client, targetMsid);
        try {
          const result = await attachNumberToService(client, targetMsid, phone);
          if (result.attached) numbersAttached++;
          details.push({
            user: email,
            phone,
            msid: targetMsid,
            attached: result.attached,
            reason: result.reason || "ok",
          });
        } catch (e) {
          const msg = (e as any)?.message || String(e);
          console.warn(`Attach failed ${phone} -> ${targetMsid}:`, msg);
          details.push({ user: email, phone, msid: targetMsid, attached: false, error: msg });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      ranAt: new Date().toISOString(),
      usersChecked,
      servicesTouched,
      servicesCreated,
      numbersAttached,
      baseUrl: BASE_URL || null,
      statusCallback: STATUS_CALLBACK || null,
      inboundWebhook: INBOUND_WEBHOOK || null,
      details,
    });
  } catch (e) {
    console.error("twilio-daily-sync error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

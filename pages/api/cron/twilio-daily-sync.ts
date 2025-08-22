// /pages/api/cron/twilio-daily-sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";

const BASE_URL = (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "");
const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL ||
  (BASE_URL ? `${BASE_URL}/api/twilio/status-callback` : undefined);
const SHARED_MSID = process.env.TWILIO_MESSAGING_SERVICE_SID || "";

function getPlatformClient() {
  const twilio = require("twilio");
  const accountSid = process.env.TWILIO_ACCOUNT_SID!;
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const keySid = process.env.TWILIO_API_KEY_SID;
  const keySecret = process.env.TWILIO_API_KEY_SECRET;
  if (keySid && keySecret) return twilio(keySid, keySecret, { accountSid });
  return twilio(accountSid, authToken);
}

async function ensureServiceHooks(client: any, msid: string) {
  if (!msid) return;
  try {
    await client.messaging.v1.services(msid).update({
      inboundRequestUrl: `${BASE_URL}/api/twilio/inbound-sms`,
      statusCallback: STATUS_CALLBACK,
    });
  } catch (e) {
    console.warn("ensureServiceHooks failed:", (e as any)?.message || e);
  }
}

async function findIncomingNumberSid(client: any, phoneNumber: string) {
  // Exact match first (fast)
  const exact = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
  if (exact?.[0]?.sid) return exact[0].sid;

  // Fallback: search by nationalized digits
  const normalizedDigits = (phoneNumber || "").replace(/[^\d]/g, "");
  const page = await client.incomingPhoneNumbers.list({ limit: 1000 });
  const match = page.find((n: any) => (n.phoneNumber || "").replace(/[^\d]/g, "") === normalizedDigits);
  return match?.sid || null;
}

async function attachNumberToService(client: any, msid: string, phoneNumber: string) {
  if (!msid || !phoneNumber) return { attached: false, reason: "missing-data" };

  const numSid = await findIncomingNumberSid(client, phoneNumber);
  if (!numSid) return { attached: false, reason: "number-not-found" };

  // Already attached?
  const attachedList = await client.messaging.v1.services(msid).phoneNumbers.list({ limit: 1000 });
  const already = attachedList.some((p: any) => p.phoneNumberSid === numSid);
  if (already) return { attached: false, reason: "already-attached" };

  await client.messaging.v1.services(msid).phoneNumbers.create({ phoneNumberSid: numSid });
  console.log(`🔗 Attached ${phoneNumber} (sid=${numSid}) -> ${msid}`);
  return { attached: true };
}

/**
 * Auth:
 *  - Preferred: GET with Authorization: Bearer <VERCEL_CRON_SECRET>
 *  - Also accepts: GET with x-vercel-cron header (Vercel Cron)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ message: "Method not allowed" });

  const secret = process.env.VERCEL_CRON_SECRET;
  const authHeader = req.headers.authorization || "";
  const hasBearer = !!secret && authHeader === `Bearer ${secret}`;
  const isVercelCron = !!req.headers["x-vercel-cron"];
  if (!hasBearer && !isVercelCron) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();
    const client = getPlatformClient();

    const users = await User.find({})
      .select({ email: 1, name: 1, numbers: 1, a2p: 1 })
      .lean();

    let usersChecked = 0;
    let servicesTouched = 0;
    let numbersAttached = 0;
    const details: any[] = [];

    for (const u of users) {
      usersChecked++;

      // Determine the default messaging service for this user
      const legacy = await A2PProfile.findOne({ userId: String((u as any)._id) }).lean();
      const defaultMsid =
        (u as any).a2p?.messagingServiceSid ||
        SHARED_MSID ||
        legacy?.messagingServiceSid ||
        "";

      // If user has no service and there is no shared one, skip (first outbound send will create per-tenant service via ensureTenantMessagingService)
      if (!defaultMsid) {
        details.push({ user: u.email, msid: null, action: "skipped-no-service" });
        continue;
      }

      await ensureServiceHooks(client, defaultMsid);
      servicesTouched++;

      const numbers: any[] = Array.isArray((u as any).numbers) ? (u as any).numbers : [];
      for (const n of numbers) {
        const phone = n?.phoneNumber;
        if (!phone) continue;

        // Per-number override beats user default (optional field in your schema)
        const targetMsid = n?.messagingServiceSid || defaultMsid;
        await ensureServiceHooks(client, targetMsid);

        try {
          const result = await attachNumberToService(client, targetMsid, phone);
          if (result.attached) numbersAttached++;
          details.push({
            user: u.email,
            phone,
            msid: targetMsid,
            attached: result.attached,
            reason: result.reason || "ok",
          });
        } catch (e) {
          const msg = (e as any)?.message || String(e);
          console.warn(`Attach failed ${phone} -> ${targetMsid}:`, msg);
          details.push({ user: u.email, phone, msid: targetMsid, attached: false, error: msg });
        }
      }
    }

    return res.status(200).json({
      ok: true,
      ranAt: new Date().toISOString(),
      usersChecked,
      servicesTouched,
      numbersAttached,
      baseUrl: BASE_URL,
      statusCallback: STATUS_CALLBACK || null,
      details,
    });
  } catch (e) {
    console.error("twilio-daily-sync error:", e);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

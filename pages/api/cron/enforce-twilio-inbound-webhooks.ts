import type { NextApiRequest, NextApiResponse } from "next";
import twilio from "twilio";
import mongoose from "mongoose";

/**
 * Enforces inbound webhook URLs across ALL user subaccounts:
 * - MessagingService.inboundRequestUrl
 * - IncomingPhoneNumber.smsUrl
 *
 * Secured by CRON_SECRET (query ?token= or Authorization: Bearer) OR x-vercel-cron.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const secret = process.env.CRON_SECRET || "";
  const token = String(req.query.token || "");
  const authHeader = String(req.headers.authorization || "");
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  const isVercelCron = !!req.headers["x-vercel-cron"];
  const okAuth = (!!secret && (token === secret || bearer === secret)) || isVercelCron;

  if (!okAuth) return res.status(403).json({ ok: false, error: "Forbidden" });

  const mongo = process.env.MONGODB_URI;
  if (!mongo) return res.status(500).json({ ok: false, error: "Missing MONGODB_URI" });

  const base = (process.env.RAW_BASE_URL || process.env.PUBLIC_BASE_URL || "https://www.covecrm.com").replace(/\/$/, "");
  const webhookSecret = process.env.TWILIO_WEBHOOK_SECRET || "";
  if (!webhookSecret) {
    return res.status(500).json({ ok: false, error: "Missing TWILIO_WEBHOOK_SECRET" });
  }

  const inboundUrl = `${base}/api/twilio/inbound-sms?token=${encodeURIComponent(webhookSecret)}`;

  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongo);
  }

  // Query raw users collection to avoid model path issues
  const db = mongoose.connection.db;
  if (!db) return res.status(500).json({ ok: false, error: "Mongo db handle unavailable" });
  const usersCol = db.collection("users");
const cursor = usersCol.find(
    {
      "twilio.accountSid": { $exists: true, $ne: "" },
      "a2p.messagingServiceSid": { $exists: true, $ne: "" },
    },
    { projection: { email: 1, twilio: 1, a2p: 1 } }
  );

  const masterSid = process.env.TWILIO_ACCOUNT_SID || "";
  const masterToken = process.env.TWILIO_AUTH_TOKEN || "";
  if (!masterSid || !masterToken) {
    return res.status(500).json({ ok: false, error: "Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN" });
  }

  let scanned = 0;
  let updatedServices = 0;
  let updatedNumbers = 0;
  const failures: Array<{ email?: string; subSid?: string; reason: string }> = [];

  while (await cursor.hasNext()) {
    const u: any = await cursor.next();
    scanned++;

    const subSid = u?.twilio?.accountSid;
    const msSid = u?.a2p?.messagingServiceSid;
    const email = u?.email;

    if (!subSid || !msSid) continue;

    const client = twilio(masterSid, masterToken, { accountSid: subSid });

    try {
      const ms = await client.messaging.v1.services(msSid).fetch();
      if (ms.inboundRequestUrl !== inboundUrl) {
        await client.messaging.v1.services(msSid).update({ inboundRequestUrl: inboundUrl });
        updatedServices++;
      }
    } catch (e: any) {
      failures.push({ email, subSid, reason: `MessagingService update failed: ${e?.message || String(e)}` });
      continue;
    }

    try {
      const nums = await client.incomingPhoneNumbers.list({ limit: 200 });
      const attached = nums.filter((n: any) => n.messagingServiceSid === msSid);
      for (const n of attached) {
        if (n.smsUrl !== inboundUrl || (n.smsMethod || "").toUpperCase() !== "POST") {
          await client.incomingPhoneNumbers(n.sid).update({ smsUrl: inboundUrl, smsMethod: "POST" });
          updatedNumbers++;
        }
      }
    } catch (e: any) {
      failures.push({ email, subSid, reason: `IncomingPhoneNumbers update failed: ${e?.message || String(e)}` });
      continue;
    }
  }

  return res.status(200).json({
    ok: true,
    inboundUrl,
    scannedUsers: scanned,
    updatedServices,
    updatedNumbers,
    failuresCount: failures.length,
    failures: failures.slice(0, 20),
  });
}

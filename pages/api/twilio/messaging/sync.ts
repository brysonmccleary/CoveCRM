// pages/api/twilio/messaging/sync.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
const INBOUND_SMS_WEBHOOK = `${BASE_URL}/api/twilio/inbound-sms`;
const STATUS_CALLBACK =
  process.env.A2P_STATUS_CALLBACK_URL || `${BASE_URL}/api/twilio/status-callback`;

/** Mask helper for logs */
function maskSid(sid?: string | null) {
  if (!sid) return null;
  return sid.length > 8 ? `${sid.slice(0, 4)}…${sid.slice(-4)}` : sid;
}

/** Add a number to a Messaging Service; handle 21712 re-linking in the SAME account */
async function addNumberToMessagingService(client: any, serviceSid: string, numberSid: string) {
  try {
    await client.messaging.v1.services(serviceSid).phoneNumbers.create({
      phoneNumberSid: numberSid,
    });
  } catch (err: any) {
    if (err?.code === 21712) {
      // unlink everywhere then reattach
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try {
          await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
        } catch {
          /* not linked — ignore */
        }
      }
      await client.messaging.v1.services(serviceSid).phoneNumbers.create({
        phoneNumberSid: numberSid,
      });
    } else {
      throw err;
    }
  }
}

/** Ensure a tenant Messaging Service in the CURRENT Twilio account (platform path) */
async function ensureTenantMessagingServiceInThisAccount(client: any, userId: string, friendlyName?: string) {
  let a2p = await A2PProfile.findOne({ userId });

  if (a2p?.messagingServiceSid) {
    await client.messaging.v1.services(a2p.messagingServiceSid).update({
      friendlyName: `CoveCRM – ${friendlyName || userId}`,
      inboundRequestUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    });
    return a2p.messagingServiceSid;
  }

  const svc = await client.messaging.v1.services.create({
    friendlyName: `CoveCRM – ${friendlyName || userId}`,
    inboundRequestUrl: INBOUND_SMS_WEBHOOK,
    statusCallback: STATUS_CALLBACK,
  });

  if (a2p) {
    a2p.messagingServiceSid = svc.sid;
    await a2p.save();
  } else {
    await A2PProfile.create({ userId, messagingServiceSid: svc.sid });
  }
  return svc.sid;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  const { attachNumbers = true, messagingServiceSid: bodyMsid }: { attachNumbers?: boolean; messagingServiceSid?: string } =
    (req.body as any) || {};

  try {
    await dbConnect();

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const { client, accountSid: activeAccountSid } = await getClientForUser(email);

    // Decide target Messaging Service:
    // 1) explicit from body
    // 2) global shared MSID (env)
    // 3) user-level A2P link
    // 4) ensure/create tenant MS in this account
    let targetMS =
      bodyMsid ||
      process.env.TWILIO_MESSAGING_SERVICE_SID ||
      (user as any).a2p?.messagingServiceSid ||
      (await ensureTenantMessagingServiceInThisAccount(client, String(user._id), user.name || user.email));

    // Make sure hooks are fresh on target service
    await client.messaging.v1.services(targetMS).update({
      inboundRequestUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    });

    // Optionally attach all owned numbers to the service
    let attached = 0;
    if (attachNumbers && Array.isArray(user.numbers) && user.numbers.length) {
      for (const n of user.numbers as any[]) {
        try {
          if (n?.sid) {
            await addNumberToMessagingService(client, targetMS, n.sid);
            attached++;
          }
        } catch (e) {
          // don’t fail whole sync for one number
          console.warn(`number attach failed sid=${maskSid(n?.sid)} →`, (e as any)?.message || e);
        }
      }
    }

    // Persist link on user.a2p (handy if it wasn’t set before)
    (user as any).a2p = (user as any).a2p || {};
    if (!(user as any).a2p.messagingServiceSid) {
      (user as any).a2p.messagingServiceSid = targetMS;
      await user.save();
    }

    return res.status(200).json({
      ok: true,
      messagingServiceSid: targetMS,
      accountSid: activeAccountSid,
      attachedCount: attached,
      inboundRequestUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    });
  } catch (err: any) {
    console.error("sync error:", err?.message || err);
    return res.status(500).json({ ok: false, error: err?.message || "sync failed" });
  }
}

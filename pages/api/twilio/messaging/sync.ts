import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import A2PProfile from "@/models/A2PProfile";
import PhoneNumber from "@/models/PhoneNumber";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

/**
 * Idempotent per-user Messaging Service sync.
 * - Works for platform-billed and self-billed users (uses getClientForUser).
 * - Ensures a Messaging Service exists in the *resolved* account.
 * - Refreshes Integration hooks to your domain.
 * - Attaches all owned numbers.
 * - Persists service SID to User.a2p.messagingServiceSid and A2PProfile.messagingServiceSid.
 *
 * POST only. No request body needed.
 */

const BASE_URL =
  (process.env.NEXT_PUBLIC_BASE_URL || process.env.BASE_URL || "").replace(/\/$/, "") ||
  "http://localhost:3000";

const INBOUND_SMS_WEBHOOK = `${BASE_URL}/api/twilio/inbound-sms`;
const STATUS_CALLBACK = `${BASE_URL}/api/twilio/status-callback`;

/** Utility to mask SIDs in logs (ACxxxx... or MGxxxx... etc.) */
function maskSid(sid?: string): string | null {
  if (!sid) return null;
  if (sid.length <= 6) return sid;
  return `${sid.slice(0, 4)}…${sid.slice(-4)}`;
}

/** Add a number to a Messaging Service sender pool. Handles 21712 (unlink/reattach) within the SAME Twilio account. */
async function addNumberToMessagingService(
  client: any,
  serviceSid: string,
  numberSid: string,
) {
  try {
    await client.messaging.v1.services(serviceSid).phoneNumbers.create({
      phoneNumberSid: numberSid,
    });
  } catch (err: any) {
    // 21712: Resource already associated with a different Messaging Service (in this account)
    if (err?.code === 21712) {
      const services = await client.messaging.v1.services.list({ limit: 100 });
      for (const svc of services) {
        try {
          await client.messaging.v1.services(svc.sid).phoneNumbers(numberSid).remove();
        } catch {
          // ignore if not linked
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return res.status(401).json({ message: "Unauthorized" });

  try {
    await dbConnect();

    // Resolve user and Twilio client for the *correct* account (platform or personal)
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found" });

    const { client, accountSid, usingPersonal } = await getClientForUser(email);

    // Find or create per-user Messaging Service in THIS account
    // Priority:
    // 1) A2PProfile.messagingServiceSid
    // 2) User.a2p.messagingServiceSid
    // 3) Create a new one
    let serviceSid: string | undefined =
      (await A2PProfile.findOne({ userId: String(user._id) }).lean())?.messagingServiceSid ||
      (user as any)?.a2p?.messagingServiceSid ||
      undefined;

    let createdNew = false;

    async function upsertService(): Promise<string> {
      if (serviceSid) {
        // Try to fetch to confirm it exists in this account
        try {
          const svc = await client.messaging.v1.services(serviceSid).fetch();
          // Refresh hooks every time to be safe
          await client.messaging.v1.services(serviceSid).update({
            friendlyName: `CoveCRM – ${user.name || user.email}`,
            inboundRequestUrl: INBOUND_SMS_WEBHOOK,
            statusCallback: STATUS_CALLBACK,
          });
          return svc.sid;
        } catch {
          // fall-through to creation (SID may belong to a different account or was deleted)
        }
      }

      const svc = await client.messaging.v1.services.create({
        friendlyName: `CoveCRM – ${user.name || user.email}`,
        inboundRequestUrl: INBOUND_SMS_WEBHOOK,
        statusCallback: STATUS_CALLBACK,
      });
      createdNew = true;
      return svc.sid;
    }

    serviceSid = await upsertService();

    // Attach all known numbers owned by this user
    // Source of truth: User.numbers[].sid (PN...), fallback to PhoneNumber collection
    const pnSids = new Set<string>();

    (user.numbers || []).forEach((n: any) => {
      if (n?.sid) pnSids.add(n.sid);
    });

    // Fallback: numbers in PhoneNumber collection for this user
    const extraNums = await PhoneNumber.find({ userId: user._id }, { twilioSid: 1 }).lean();
    (extraNums || []).forEach((p: any) => {
      if (p?.twilioSid) pnSids.add(p.twilioSid);
    });

    const attached: string[] = [];
    const failed: Array<{ sid: string; error: string }> = [];

    for (const pnSid of pnSids) {
      try {
        await addNumberToMessagingService(client, serviceSid, pnSid);
        attached.push(pnSid);
      } catch (e: any) {
        failed.push({ sid: pnSid, error: e?.message || "attach failed" });
      }
    }

    // Persist linkage on both documents
    // User.a2p
    (user as any).a2p = (user as any).a2p || {};
    (user as any).a2p.messagingServiceSid = serviceSid;
    (user as any).a2p.lastSyncedAt = new Date();
    await user.save();

    // A2PProfile
    await A2PProfile.updateOne(
      { userId: String(user._id) },
      { $set: { messagingServiceSid: serviceSid, updatedAt: new Date() } },
      { upsert: true },
    );

    const result = {
      ok: true,
      usingPersonal,
      accountSid,
      messagingServiceSid: serviceSid,
      createdNew,
      attachedCount: attached.length,
      attached,
      failed,
      inboundUrl: INBOUND_SMS_WEBHOOK,
      statusCallback: STATUS_CALLBACK,
    };

    console.log(
      JSON.stringify({
        msg: "messaging/sync",
        email,
        usingPersonal,
        accountSidMasked: maskSid(accountSid),
        messagingServiceSid: maskSid(serviceSid),
        createdNew,
        attachedCount: attached.length,
        failedCount: failed.length,
      }),
    );

    return res.status(200).json(result);
  } catch (err: any) {
    console.error("messaging/sync error:", err);
    return res.status(500).json({
      ok: false,
      message: err?.message || "Failed to sync messaging",
    });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Message from "@/models/Message";
import User from "@/models/User";
import { getClientForUser } from "@/lib/twilio/getClientForUser";

/**
 * GET /api/messages/lookup?sid=SMxxxxxxxxx
 *
 * - Auth required.
 * - Returns the Message row (DB source of truth) AND the Twilio REST status for comparison.
 * - Uses the owner user (Message.userEmail) to choose the correct Twilio client (self vs platform).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  // Make session typed so TS knows about `.user`
  const session = (await getServerSession(req, res, authOptions as any)) as Session | null;
  const sessionEmail =
    typeof session?.user?.email === "string" ? session.user.email.toLowerCase() : "";
  if (!sessionEmail) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const sid = String(req.query.sid || "").trim();
  if (!sid) {
    return res.status(400).json({ message: "Missing sid" });
  }

  try {
    await dbConnect();

    // Try to load the DB record first
    const dbMsg = await Message.findOne({ sid }).lean();
    if (!dbMsg) {
      // Fall back: allow the logged-in user to query Twilio directly even if DB row is missing
      console.warn(`⚠️ /api/messages/lookup: DB row not found for sid=${sid}, falling back to session user`);
      const { client } = await getClientForUser(sessionEmail);
      const tw: any = await client.messages(sid).fetch();
      console.log(`🔎 lookup(no-db) sid=${sid} status=${tw?.status}`);

      return res.status(200).json({
        db: null,
        twilio: serializeTwilioMsg(tw),
        match: false,
      });
    }

    // Enforce ownership: the session user must match the message owner
    const ownerEmail = String(dbMsg.userEmail || "").toLowerCase();
    if (ownerEmail !== sessionEmail) {
      // If you later add roles, you can permit admins here.
      return res.status(403).json({ message: "Forbidden for this message owner" });
    }

    // Use the owner's client (handles self-billed vs platform-billed)
    const ownerUser = await User.findOne({ email: ownerEmail });
    if (!ownerUser?._id) {
      return res.status(404).json({ message: "Owner user not found" });
    }

    const { client } = await getClientForUser(ownerEmail);
    const tw: any = await client.messages(sid).fetch();

    // Compose response with a simple diff
    const dbStatus = String(dbMsg.status || "").toLowerCase();
    const twStatus = String(tw?.status || "").toLowerCase();
    const match = dbStatus === twStatus;

    console.log(`🔎 lookup sid=${sid} db=${dbStatus} tw=${twStatus} match=${match ? "✅" : "❌"}`);

    return res.status(200).json({
      db: serializeDbMsg(dbMsg as any),
      twilio: serializeTwilioMsg(tw),
      match,
    });
  } catch (err: any) {
    console.error("❌ /api/messages/lookup error:", err?.message || err);
    return res.status(500).json({ message: err?.message || "Lookup failed" });
  }
}

/** Normalize DB Message for API output */
function serializeDbMsg(m: any) {
  return {
    _id: m?._id ? String(m._id) : null,
    leadId: m?.leadId ? String(m.leadId) : null,
    userEmail: m?.userEmail || null,
    direction: m?.direction || null,
    text: m?.text || "",
    status: m?.status || null,
    errorCode: m?.errorCode || null,
    to: m?.to || null,
    from: m?.from || null,
    fromServiceSid: m?.fromServiceSid || null,
    sentAt: m?.sentAt || null,
    scheduledAt: m?.scheduledAt || null,
    deliveredAt: m?.deliveredAt || null,
    failedAt: m?.failedAt || null,
    createdAt: m?.createdAt || null,
    updatedAt: m?.updatedAt || null,
  };
}

/** Normalize Twilio Message resource for API output */
function serializeTwilioMsg(tw: any) {
  return {
    sid: tw?.sid || null,
    status: tw?.status || null,
    to: (tw?.to as string) || null,
    from: (tw?.from as string) || null,
    messagingServiceSid: (tw?.messagingServiceSid as string) || null,
    errorCode: tw?.errorCode ?? null,
    numSegments: tw?.numSegments ?? null,
    dateCreated: tw?.dateCreated ? new Date(tw.dateCreated).toISOString() : null,
    dateSent: tw?.dateSent ? new Date(tw.dateSent).toISOString() : null,
    dateUpdated: tw?.dateUpdated ? new Date(tw.dateUpdated).toISOString() : null,
  };
}

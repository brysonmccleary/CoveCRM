import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";

type LeanLead = {
  _id: any;
  userEmail?: string | null;
  ownerEmail?: string | null;
  firstName?: string;
  lastName?: string;
  Phone?: string;
  phone?: string;
  ["First Name"]?: string;
  ["Last Name"]?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = (await getServerSession(
      req,
      res,
      authOptions as any,
    )) as Session | null;

    const userEmail =
      typeof session?.user?.email === "string"
        ? session.user.email.toLowerCase()
        : "";
    if (!userEmail) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await dbConnect();

    // Grab leads and all messages for this user (latest first)
    const [leads, messages] = await Promise.all([
      Lead.find({ userEmail }).lean<LeanLead[]>().exec(),
      Message.find({ userEmail }).sort({ createdAt: -1 }).lean().exec(),
    ]);

    // Quick lookup
    const leadById = new Map<string, LeanLead>();
    for (const l of leads) leadById.set(String(l._id), l);

    // Unread counts & pick latest-per-lead (messages already sorted desc)
    const unreadByLead = new Map<string, number>();
    const latestByLead = new Map<string, any>();

    for (const m of messages as any[]) {
      const leadIdStr = String(m.leadId || "");
      if (!leadIdStr) continue;

      // unread aggregation
      if (m.direction === "inbound" && !m.read) {
        unreadByLead.set(leadIdStr, (unreadByLead.get(leadIdStr) || 0) + 1);
      }

      // first seen is latest due to sort desc
      if (!latestByLead.has(leadIdStr)) {
        latestByLead.set(leadIdStr, m);
      }
    }

    // Build conversation rows
    const conversations: any[] = [];
    for (const [leadIdStr, lastMsg] of latestByLead.entries()) {
      const lead = leadById.get(leadIdStr);
      if (!lead) continue;

      const fullName = `${lead.firstName || lead["First Name"] || ""} ${lead.lastName || lead["Last Name"] || ""}`.trim();
      const phone = lead.Phone || lead.phone || "";
      const displayName = fullName || phone || "Unknown";

      // prefer concrete lifecycle timestamps for sorting/UX
      const lastMessageTime =
        lastMsg.deliveredAt ||
        lastMsg.sentAt ||
        lastMsg.scheduledAt ||
        lastMsg.createdAt ||
        lastMsg.date ||
        new Date();

      const unreadCount = unreadByLead.get(leadIdStr) || 0;

      conversations.push({
        _id: lead._id,
        name: displayName,
        phone,

        // last message preview
        lastMessage: lastMsg.text || lastMsg.body || "",
        lastMessageTime,
        lastMessageDirection: lastMsg.direction || null,

        // delivery lifecycle (DB = source of truth)
        lastMessageSid: lastMsg.sid || null,
        lastMessageStatus: lastMsg.status || null, // queued | accepted | sending | sent | delivered | failed | undelivered | error | suppressed | scheduled
        lastMessageErrorCode: lastMsg.errorCode || null,
        lastMessageSuppressed:
          Boolean(lastMsg.suppressed) || lastMsg.status === "suppressed",
        lastMessageScheduledAt: lastMsg.scheduledAt || null,
        lastMessageDeliveredAt: lastMsg.deliveredAt || null,
        lastMessageFailedAt: lastMsg.failedAt || null,

        // unread badge
        unread: unreadCount > 0,
        unreadCount,
      });
    }

    // Sort by last activity time desc
    conversations.sort(
      (a, b) =>
        new Date(b.lastMessageTime).getTime() -
        new Date(a.lastMessageTime).getTime(),
    );

    return res.status(200).json(conversations);
  } catch (error) {
    console.error("Conversations API Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

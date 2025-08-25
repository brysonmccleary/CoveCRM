import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
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

    await mongooseConnect();

    // Efficiently compute latest message per lead + unread counts in Mongo
    const latest = await Message.aggregate([
      { $match: { userEmail } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$leadId",
          last: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$direction", "inbound"] }, { $eq: ["$read", false] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]).exec();

    const leadIds = latest.map((r: any) => r._id).filter(Boolean);
    const leads = await Lead.find({ _id: { $in: leadIds } })
      .lean<LeanLead[]>()
      .exec();

    // Quick lookup
    const leadById = new Map<string, LeanLead>();
    for (const l of leads) leadById.set(String(l._id), l);

    // Build conversation rows (shape preserved)
    const conversations: any[] = [];
    for (const row of latest as any[]) {
      const leadIdStr = String(row._id || "");
      const lastMsg = row.last || {};
      const unreadCount = Number(row.unreadCount || 0);

      const lead = leadById.get(leadIdStr);
      if (!lead) continue;

      const fullName = `${lead.firstName || lead["First Name"] || ""} ${lead.lastName || lead["Last Name"] || ""}`.trim();
      const phone = lead.Phone || lead.phone || "";
      const displayName = fullName || phone || "Unknown";

      const lastMessageTime =
        lastMsg.deliveredAt ||
        lastMsg.sentAt ||
        lastMsg.scheduledAt ||
        lastMsg.createdAt ||
        lastMsg.date ||
        new Date();

      conversations.push({
        _id: lead._id,
        name: displayName,
        phone,

        lastMessage: lastMsg.text || lastMsg.body || "",
        lastMessageTime,
        lastMessageDirection: lastMsg.direction || null,

        lastMessageSid: lastMsg.sid || null,
        lastMessageStatus: lastMsg.status || null, // queued | accepted | sending | sent | delivered | failed | undelivered | error | suppressed | scheduled
        lastMessageErrorCode: lastMsg.errorCode || null,
        lastMessageSuppressed:
          Boolean(lastMsg.suppressed) || lastMsg.status === "suppressed",
        lastMessageScheduledAt: lastMsg.scheduledAt || null,
        lastMessageDeliveredAt: lastMsg.deliveredAt || null,
        lastMessageFailedAt: lastMsg.failedAt || null,

        unread: unreadCount > 0,
        unreadCount,
      });
    }

    // Sort by last activity time desc (aggregation preserves latest, but sort for safety)
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

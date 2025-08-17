// pages/api/message/conversations.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";        // canonical casing
import Message from "@/models/Message";  // assuming this is already canonical

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions);
    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await dbConnect();

    const userEmail = session.user.email;

    // Fetch leads and messages for this user
    const [leads, messages] = await Promise.all([
      Lead.find({ userEmail }).lean(),
      Message.find({ userEmail }).sort({ createdAt: -1 }).lean(),
    ]);

    const conversationsMap = new Map<string, any>();

    for (const msg of messages) {
      const leadIdStr = msg.leadId?.toString?.();
      if (!leadIdStr) continue;

      if (!conversationsMap.has(leadIdStr)) {
        const lead = leads.find((l) => l._id.toString() === leadIdStr);
        if (!lead) continue;

        const fullName = `${lead["First Name"] || ""} ${lead["Last Name"] || ""}`.trim();
        const displayName = fullName || lead.Phone || "Unknown";

        const isUnread = msg.direction === "inbound" && !msg.read;

        conversationsMap.set(leadIdStr, {
          _id: lead._id,
          name: displayName,
          phone: lead.Phone,
          lastMessage: msg.text,
          lastMessageTime: msg.createdAt,
          unread: isUnread,
        });
      }
    }

    const conversations = Array.from(conversationsMap.values()).sort(
      (a, b) => new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    );

    return res.status(200).json(conversations);
  } catch (error) {
    console.error("Conversations API Error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

// /pages/api/message/conversations.ts
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

    // Fetch leads and messages for this user
    const [leads, messages] = await Promise.all([
      Lead.find({ userEmail }).lean<LeanLead[]>().exec(),
      Message.find({ userEmail }).sort({ createdAt: -1 }).lean().exec(),
    ]);

    const conversationsMap = new Map<string, any>();

    for (const msg of messages as any[]) {
      const leadIdStr = String((msg as any).leadId || "");
      if (!leadIdStr) continue;

      if (!conversationsMap.has(leadIdStr)) {
        const lead = leads.find((l) => String(l._id) === leadIdStr);
        if (!lead) continue;

        const fullName = `${lead.firstName || lead["First Name"] || ""} ${lead.lastName || lead["Last Name"] || ""}`.trim();
        const phone = lead.Phone || lead.phone || "";
        const displayName = fullName || phone || "Unknown";

        const isUnread =
          (msg as any).direction === "inbound" && !(msg as any).read;

        conversationsMap.set(leadIdStr, {
          _id: lead._id,
          name: displayName,
          phone,
          lastMessage: (msg as any).text || (msg as any).body || "",
          lastMessageTime:
            (msg as any).createdAt || (msg as any).date || new Date(),
          unread: Boolean(isUnread),
        });
      }
    }

    const conversations = Array.from(conversationsMap.values()).sort(
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

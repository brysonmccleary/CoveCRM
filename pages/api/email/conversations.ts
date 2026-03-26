// pages/api/email/conversations.ts
// Lists leads that have email messages, with latest message metadata.
// Powers the InboxSidebar in email mode.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailMessage from "@/models/EmailMessage";
import Lead from "@/models/Lead";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();

  await mongooseConnect();

  // Group by leadId, pick latest message per lead
  const groups = await EmailMessage.aggregate([
    { $match: { userEmail } },
    { $sort: { sentAt: -1, createdAt: -1 } },
    {
      $group: {
        _id: "$leadId",
        lastSubject: { $first: "$subject" },
        lastMessageTime: { $first: "$sentAt" },
        lastCreatedAt: { $first: "$createdAt" },
        lastStatus: { $first: "$status" },
        to: { $first: "$to" },
        direction: { $first: "$direction" },
      },
    },
    { $sort: { lastMessageTime: -1 } },
    { $limit: 100 },
  ]);

  if (!groups.length) return res.status(200).json([]);

  const leadIds = groups.map((g: any) => g._id);
  const leads = await Lead.find({ _id: { $in: leadIds } })
    .select("_id firstName lastName name Email email")
    .lean();

  const leadMap = new Map(leads.map((l: any) => [String(l._id), l]));

  const conversations = groups.map((item: any) => {
    const lead: any = leadMap.get(String(item._id)) || {};
    const firstName =
      lead.firstName || lead["First Name"] || lead["first_name"] || "";
    const lastName =
      lead.lastName || lead["Last Name"] || lead["last_name"] || "";
    const name =
      lead.name ||
      [firstName, lastName].filter(Boolean).join(" ") ||
      item.to ||
      "Unknown";

    return {
      _id: String(item._id),
      name,
      email: item.to,
      lastMessage: item.lastSubject || "(no subject)",
      lastMessageTime: item.lastMessageTime || item.lastCreatedAt,
      lastStatus: item.lastStatus,
      direction: item.direction,
    };
  });

  return res.status(200).json(conversations);
}

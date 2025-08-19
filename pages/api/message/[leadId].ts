// /pages/api/message/[leadId].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/dbConnect";
import Lead from "@/models/Lead";
import Message from "@/models/Message";

type LeanLead = {
  _id: any;
  ownerEmail?: string | null;
  userEmail?: string | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });

  // ✅ Auth (use same approach as the rest of your API)
  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  const { leadId } = req.query as { leadId: string };
  if (!leadId) return res.status(400).json({ error: "Missing leadId" });

  await dbConnect();

  // ✅ Make sure this lead belongs to the signed-in user
  const lead = await Lead.findById(leadId).lean<LeanLead>().exec();
  if (!lead) return res.status(404).json({ error: "Lead not found" });

  const ownerEmail = String(lead.ownerEmail || lead.userEmail || "").toLowerCase();
  if (ownerEmail !== email)
    return res.status(401).json({ error: "Not your lead" });

  // ✅ Authorized — return the conversation messages for this lead
  const messages = await Message.find({ leadId }).sort({ createdAt: 1 }).lean();

  return res.status(200).json(messages || []);
}

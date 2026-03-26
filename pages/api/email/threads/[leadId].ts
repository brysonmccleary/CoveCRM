// pages/api/email/threads/[leadId].ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailMessage from "@/models/EmailMessage";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();
  const { leadId } = req.query;

  if (!leadId || typeof leadId !== "string") {
    return res.status(400).json({ error: "leadId is required" });
  }

  await mongooseConnect();

  const messages = await EmailMessage.find({ leadId, userEmail })
    .sort({ sentAt: 1, createdAt: 1 })
    .lean();

  return res.status(200).json(messages);
}

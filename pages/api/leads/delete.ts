// pages/api/leads/delete.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ message: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ message: "Unauthorized" });

  const { leadId } = (req.body || {}) as { leadId?: string };
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  try {
    await dbConnect();

    const lead = await Lead.findOne({ _id: leadId, userEmail: session.user.email });
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    await Lead.deleteOne({ _id: leadId, userEmail: session.user.email });

    return res.status(200).json({ success: true });
  } catch (err: any) {
    console.error("POST /api/leads/delete error:", err?.message || err);
    return res.status(500).json({ message: "Server error" });
  }
}

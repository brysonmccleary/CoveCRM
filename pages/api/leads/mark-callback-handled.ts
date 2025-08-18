import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).end("Unauthorized");

  const { leadId } = req.body;
  if (!leadId) return res.status(400).json({ message: "Missing leadId" });

  try {
    await dbConnect();

    const lead = await Lead.findOne({
      _id: leadId,
      userEmail: session.user.email,
    });

    if (!lead) return res.status(404).json({ message: "Lead not found" });

    // ✅ Reset callback state
    lead.isInboundCallback = false;
    lead.callbackNotified = false;

    await lead.save();

    return res.status(200).json({ message: "Callback handled" });
  } catch (err) {
    console.error("❌ Error marking callback handled:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

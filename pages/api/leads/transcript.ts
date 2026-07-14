// /pages/api/leads/add-transcript.ts

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
  const userEmail = session?.user?.email?.toLowerCase();
  if (!userEmail) return res.status(401).json({ message: "Unauthorized" });

  const { leadId, entry } = req.body;
  if (!leadId || !entry?.text)
    return res.status(400).json({ message: "Missing parameters" });

  try {
    await dbConnect();
    const lead = await Lead.findOne({ _id: leadId, userEmail });
    if (!lead) return res.status(404).json({ message: "Lead not found" });

    if (!Array.isArray(lead.callTranscripts)) {
      lead.callTranscripts = [];
    }

    lead.callTranscripts.push(entry);
    await lead.save();

    res.status(200).json({ message: "Transcript added" });
  } catch (err) {
    console.error("Error saving transcript:", err);
    res.status(500).json({ message: "Server error" });
  }
}

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Lead from "@/models/Lead";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  try {
    // Get all leads with their folderId
    const leads = await Lead.find().select("folderId").lean();
    const counts: Record<string, number> = {};

    leads.forEach((lead) => {
      const id = lead.folderId?.toString();
      if (id) {
        counts[id] = (counts[id] || 0) + 1;
      }
    });

    res.status(200).json({ counts });
  } catch (err) {
    console.error("Error fetching folder counts:", err);
    res.status(500).json({ message: "Error fetching folder counts" });
  }
}

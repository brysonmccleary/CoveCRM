import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;

  await dbConnect();

  if (req.method === "GET") {
    const drip = await DripCampaign.findById(id);
    if (!drip) return res.status(404).json({ error: "Drip not found" });
    return res.status(200).json(drip);
  }

  if (req.method === "PUT") {
    try {
      const updated = await DripCampaign.findByIdAndUpdate(id, req.body, { new: true });
      if (!updated) return res.status(404).json({ error: "Drip not found" });
      return res.status(200).json(updated);
    } catch (error) {
      return res.status(400).json({ error: "Error updating drip" });
    }
  }

  if (req.method === "DELETE") {
    try {
      await DripCampaign.findByIdAndDelete(id);
      return res.status(200).json({ message: "Drip deleted" });
    } catch (error) {
      return res.status(400).json({ error: "Error deleting drip" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

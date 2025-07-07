import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await dbConnect();

  if (req.method === "GET") {
    const drips = await DripCampaign.find({});
    return res.status(200).json(drips);
  }

  if (req.method === "POST") {
    try {
      const drip = await DripCampaign.create(req.body);
      return res.status(201).json(drip);
    } catch (error) {
      return res.status(400).json({ error: "Error creating drip" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

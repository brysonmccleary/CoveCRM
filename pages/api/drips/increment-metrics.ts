import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  await dbConnect();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { dripId, stepIndex, field } = req.body;

  if (!dripId || stepIndex === undefined || !field) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const drip = await DripCampaign.findById(dripId);
    if (!drip) {
      return res.status(404).json({ error: "Drip not found" });
    }

    drip.steps[stepIndex][field] = (drip.steps[stepIndex][field] || 0) + 1;
    await drip.save();

    res.status(200).json({ success: true });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}

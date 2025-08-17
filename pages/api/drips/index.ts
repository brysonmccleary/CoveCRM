import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();
  const userEmail = session.user.email;

  if (req.method === "GET") {
    try {
      const drips = await DripCampaign.find({
        $or: [
          { user: userEmail },
          { isGlobal: true }
        ]
      });
      return res.status(200).json(drips);
    } catch (error) {
      console.error("Get drips error:", error);
      return res.status(500).json({ error: "Failed to fetch drips" });
    }
  }

  if (req.method === "POST") {
    try {
      const optOut = " Reply STOP to opt out.";
      const steps = (req.body.steps || []).map((step: { text: string; day: string }) => {
        const enforcedText = step.text.trim().endsWith(optOut)
          ? step.text.trim()
          : `${step.text.trim()}${optOut}`;
        return { ...step, text: enforcedText };
      });

      const drip = new DripCampaign({
        ...req.body,
        steps,
        user: userEmail,
      });

      await drip.save();
      return res.status(201).json(drip);
    } catch (error) {
      console.error("Create drip error:", error);
      return res.status(400).json({ error: "Error creating drip" });
    }
  }

  res.status(405).json({ error: "Method not allowed" });
}

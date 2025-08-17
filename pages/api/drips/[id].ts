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
  const { id } = req.query;

  try {
    const drip = await DripCampaign.findOne({
      _id: id,
      $or: [
        { user: userEmail },
        { isGlobal: true }
      ]
    });

    if (!drip) {
      return res.status(404).json({ error: "Drip not found or access denied" });
    }

    if (req.method === "GET") {
      return res.status(200).json(drip);
    }

    if (req.method === "PUT") {
      const { name, type, steps, assignedFolders, isActive, analytics, comments } = req.body;

      drip.name = name ?? drip.name;
      drip.type = type ?? drip.type;
      drip.steps = steps ?? drip.steps;
      drip.assignedFolders = assignedFolders ?? drip.assignedFolders;
      drip.isActive = isActive ?? drip.isActive;
      drip.analytics = analytics ?? drip.analytics;
      drip.comments = comments ?? drip.comments;

      await drip.save();
      return res.status(200).json(drip);
    }

    if (req.method === "DELETE") {
      await drip.deleteOne();
      return res.status(200).json({ message: "Drip deleted" });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Drip update/delete error:", error);
    res.status(500).json({ error: "Server error" });
  }
}

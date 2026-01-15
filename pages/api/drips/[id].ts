// pages/api/drips/[id].ts
import dbConnect from "@/lib/dbConnect";
import DripCampaign from "@/models/DripCampaign";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  await dbConnect();

  const userEmail = String(session.user.email).toLowerCase();
  const { id } = req.query;

  if (!id || typeof id !== "string") {
    return res.status(400).json({ error: "Missing id" });
  }

  try {
    // GET can read user-owned OR global
    if (req.method === "GET") {
      const drip = await DripCampaign.findOne({
        _id: id,
        $or: [{ user: userEmail }, { userEmail: userEmail }, { isGlobal: true }],
      });

      if (!drip) {
        return res.status(404).json({ error: "Drip not found or access denied" });
      }

      return res.status(200).json(drip);
    }

    // PUT/DELETE must be user-owned ONLY (never global, never other users)
    const drip = await DripCampaign.findOne({
      _id: id,
      $or: [{ user: userEmail }, { userEmail: userEmail }],
      isGlobal: { $ne: true },
    });

    if (!drip) {
      return res
        .status(404)
        .json({ error: "Drip not found or access denied" });
    }

    if (req.method === "PUT") {
      const {
        name,
        type,
        steps,
        assignedFolders,
        isActive,
        analytics,
        comments,
      } = req.body;

      // Only update fields we explicitly allow; never touch ownership fields.
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

    res.setHeader("Allow", "GET,PUT,DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    console.error("Drip update/delete error:", error);
    return res.status(500).json({ error: "Server error" });
  }
}

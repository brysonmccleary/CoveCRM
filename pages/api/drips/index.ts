import dbConnect from "@/lib/mongooseConnect";
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

  if (req.method === "GET") {
    try {
      const drips = await DripCampaign.find({
        $or: [{ userEmail }, { user: userEmail }, { isGlobal: true }],
      });
      return res.status(200).json(drips);
    } catch (error) {
      console.error("Get drips error:", error);
      return res.status(500).json({ error: "Failed to fetch drips" });
    }
  }

  if (req.method === "POST") {
    try {
      const steps = (req.body.steps || []).map(
        (step: { text: string; day: string }) => ({
          ...step,
          text: String(step?.text || "").trim(),
        }),
      );

      const drip = new DripCampaign({
        ...req.body,
        steps,
        user: userEmail,
        userEmail: userEmail,
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

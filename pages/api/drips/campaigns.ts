// pages/api/drips/campaigns.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const session = await getServerSession(req, res, authOptions as any);
    if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

    const { active } = req.query;
    await dbConnect();

    const query: any = {};
    // Optional: scope by user if campaigns are tenant-specific
    // query.createdBy = session.user.email;

    if (String(active) === "1") query.active = true;

    const campaigns = await DripCampaign.find(query)
      .select("_id name key active")
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({ campaigns });
  } catch (err: any) {
    return res.status(500).json({ error: "Server error", detail: err?.message });
  }
}

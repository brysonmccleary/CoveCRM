// pages/api/nudges/index.ts
// GET  — list active nudges for the current user
// POST — dismiss a nudge
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import FollowUpNudge from "@/models/FollowUpNudge";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    const nudges = await FollowUpNudge.find({ userEmail, dismissed: false })
      .sort({ priority: 1, generatedAt: -1 })
      .limit(5)
      .lean();
    return res.status(200).json({ nudges });
  }

  if (req.method === "POST") {
    const { nudgeId, action } = req.body as { nudgeId?: string; action?: string };
    if (!nudgeId) return res.status(400).json({ error: "nudgeId required" });

    if (action === "dismiss") {
      await FollowUpNudge.updateOne({ _id: nudgeId, userEmail }, { $set: { dismissed: true } });
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "Invalid action" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

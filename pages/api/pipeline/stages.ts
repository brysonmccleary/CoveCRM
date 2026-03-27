// pages/api/pipeline/stages.ts
// GET  — list pipeline stages for the user
// POST — create a new stage
// DELETE /?id=xxx — delete a stage
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import LeadStage from "@/models/LeadStage";

const DEFAULT_STAGES = [
  { name: "New Lead", color: "#6366f1", order: 0, isDefault: true },
  { name: "Contacted", color: "#f59e0b", order: 1, isDefault: false },
  { name: "Quoted", color: "#3b82f6", order: 2, isDefault: false },
  { name: "Follow Up", color: "#8b5cf6", order: 3, isDefault: false },
  { name: "Closed Won", color: "#22c55e", order: 4, isDefault: false },
  { name: "Closed Lost", color: "#ef4444", order: 5, isDefault: false },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();
  const userEmail = session.user.email.toLowerCase();

  if (req.method === "GET") {
    let stages = await LeadStage.find({ userEmail }).sort({ order: 1 }).lean();

    // Seed defaults if user has none
    if (stages.length === 0) {
      await LeadStage.insertMany(DEFAULT_STAGES.map((s) => ({ ...s, userEmail })));
      stages = await LeadStage.find({ userEmail }).sort({ order: 1 }).lean();
    }

    return res.status(200).json({ stages });
  }

  if (req.method === "POST") {
    const { name, color, order } = req.body as { name?: string; color?: string; order?: number };
    if (!name) return res.status(400).json({ error: "name required" });

    const maxOrder = await LeadStage.findOne({ userEmail }).sort({ order: -1 }).lean();
    const nextOrder = ((maxOrder as any)?.order ?? -1) + 1;

    const stage = await LeadStage.create({
      userEmail,
      name,
      color: color || "#6366f1",
      order: order ?? nextOrder,
    });

    return res.status(201).json({ ok: true, stage });
  }

  if (req.method === "DELETE") {
    const { id } = req.query as { id?: string };
    if (!id) return res.status(400).json({ error: "id required" });
    await LeadStage.deleteOne({ _id: id, userEmail });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

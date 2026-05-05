// pages/api/admin/doi-discovery.ts
// Admin review endpoint for DOI discovery evidence with manual override support.
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import DOIAgentDiscovery from "@/models/DOIAgentDiscovery";

const ADMIN_EMAIL = "bryson.mccleary1@gmail.com";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email || session.user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Forbidden" });
  }

  await mongooseConnect();

  if (req.method === "GET") {
    const agentId = req.query.agentId ? String(req.query.agentId) : "";
    const accepted = req.query.accepted ? req.query.accepted === "true" : undefined;
    const manual = req.query.manual ? req.query.manual === "true" : undefined;

    const filter: Record<string, any> = {};
    if (agentId) filter.agentId = agentId;
    if (typeof accepted === "boolean") filter.accepted = accepted;
    if (typeof manual === "boolean") filter.manualDecision = manual ? { $ne: "" } : "";

    const candidates = await DOIAgentDiscovery.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean();

    return res.status(200).json({ candidates });
  }

  if (req.method === "POST") {
    const { id, decision, notes } = req.body || {};
    if (!id || !decision || !["approved", "rejected"].includes(decision)) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    await DOIAgentDiscovery.updateOne(
      { _id: id },
      {
        $set: {
          manualDecision: decision,
          manualNotes: notes || "",
          checkedAt: new Date(),
        },
      }
    );

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

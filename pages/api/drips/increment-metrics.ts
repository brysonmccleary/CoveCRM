import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import DripCampaign from "@/models/DripCampaign";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });
  const email = String(session.user.email).toLowerCase();

  const { dripId, stepIndex, field } = req.body || {};
  if (!dripId || stepIndex === undefined || !field) {
    return res.status(400).json({ error: "Missing fields" });
  }

  await dbConnect();

  // ✅ allow only: global OR owned by user
  const drip = await DripCampaign.findOne({
    _id: dripId,
    $or: [{ isGlobal: true }, { userEmail: email }, { user: email }],
  });

  if (!drip) return res.status(404).json({ error: "Drip not found" });

  const idx = Number(stepIndex);
  if (!Number.isFinite(idx) || idx < 0 || idx >= ((drip as any).steps?.length || 0)) {
    return res.status(400).json({ error: "Invalid stepIndex" });
  }

  const allowed = new Set(["views", "responses", "clicks", "replies", "unsubscribes"]);
  if (!allowed.has(String(field))) return res.status(400).json({ error: "Invalid field" });

  (drip as any).steps[idx][field] = (((drip as any).steps[idx][field]) || 0) + 1;
  await drip.save();

  return res.status(200).json({ success: true });
}

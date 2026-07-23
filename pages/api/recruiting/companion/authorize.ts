import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateCompanion } from "@/lib/recruiting/companion/auth";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const companion = await authenticateCompanion(req);
  if (!companion) return res.status(401).json({ error: "Invalid companion token." });
  if (companion.paused) return res.status(409).json({ error: "Companion is paused." });

  const job = await RecruitingCompanionJob.findOne({
    _id: String(req.body?.jobId || ""),
    ownerEmail: companion.ownerEmail,
    companionId: companion._id,
    recipientLock: String(req.body?.recipientLock || ""),
    status: "claimed",
    leaseExpiresAt: { $gte: new Date() },
  }).select("_id").lean();
  if (!job) return res.status(409).json({ error: "Job authorization was revoked or expired." });
  res.setHeader("Cache-Control", "private, no-store");
  return res.status(200).json({ authorized: true });
}

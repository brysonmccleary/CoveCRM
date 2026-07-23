import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import {
  createPairingCode,
  DEFAULT_DAILY_ACTION_LIMIT,
  hashCompanionSecret,
  MAX_DAILY_ACTION_LIMIT,
  PAIRING_TTL_MS,
} from "@/lib/recruiting/companion/security";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCompanion from "@/models/RecruitingCompanion";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  await mongooseConnect();
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method === "GET") {
    const companions = await RecruitingCompanion.find({ ownerEmail: admin.email })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    return res.status(200).json({ companions });
  }

  if (req.method === "POST") {
    const label = String(req.body?.label || "").trim();
    const allowedPlatforms = [...new Set(Array.isArray(req.body?.allowedPlatforms) ? req.body.allowedPlatforms : [])]
      .filter((value) => value === "linkedin" || value === "instagram");
    const requestedLimit = Number(req.body?.dailyActionLimit || DEFAULT_DAILY_ACTION_LIMIT);
    const dailyActionLimit = Math.min(MAX_DAILY_ACTION_LIMIT, Math.max(1, Math.floor(requestedLimit)));
    if (label.length < 3 || label.length > 80) return res.status(400).json({ error: "Companion label must be 3-80 characters." });
    if (!allowedPlatforms.length) return res.status(400).json({ error: "Select at least one platform." });

    const pairingCode = createPairingCode();
    const companion = await RecruitingCompanion.create({
      ownerEmail: admin.email,
      label,
      pairingCodeHash: hashCompanionSecret(pairingCode),
      pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
      allowedPlatforms,
      dailyActionLimit,
      paused: true,
    });
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: "companion_pairing_created",
      entityType: "companion",
      entityId: String(companion._id),
      details: { allowedPlatforms, dailyActionLimit },
    });
    return res.status(201).json({
      companion: {
        _id: companion._id,
        label: companion.label,
        allowedPlatforms: companion.allowedPlatforms,
        dailyActionLimit: companion.dailyActionLimit,
        paused: companion.paused,
        pairedAt: companion.pairedAt,
      },
      pairingCode,
      pairingExpiresAt: companion.pairingExpiresAt,
    });
  }

  if (req.method === "PATCH") {
    const companionId = String(req.body?.companionId || "");
    const paused = req.body?.paused;
    if (!Types.ObjectId.isValid(companionId) || typeof paused !== "boolean") return res.status(400).json({ error: "A valid companionId and paused are required." });
    const companion = await RecruitingCompanion.findOneAndUpdate(
      { _id: companionId, ownerEmail: admin.email, enabled: true, pairedAt: { $ne: null } },
      { $set: { paused } },
      { new: true },
    );
    if (!companion) return res.status(404).json({ error: "Paired companion not found." });
    if (paused) {
      await RecruitingCompanionJob.updateMany(
        { companionId: companion._id, status: "claimed" },
        {
          $set: {
            status: "canceled",
            completedAt: new Date(),
            failureCode: "paused_by_admin",
            resultSummary: "Canceled by the admin kill switch before execution.",
          },
          $unset: { leaseExpiresAt: 1 },
        },
      );
    }
    await RecruitingAuditEvent.create({
      ownerEmail: admin.email,
      actorEmail: admin.email,
      eventType: paused ? "companion_paused" : "companion_resumed",
      entityType: "companion",
      entityId: `${companion._id}:${Date.now()}`,
      details: { companionId: String(companion._id) },
    });
    return res.status(200).json({ companion });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

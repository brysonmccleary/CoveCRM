import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { Types } from "mongoose";
import mongooseConnect from "@/lib/mongooseConnect";
import { requireRecruitingAdmin } from "@/lib/recruiting/admin";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCompanion from "@/models/RecruitingCompanion";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingSocialAction from "@/models/RecruitingSocialAction";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const admin = await requireRecruitingAdmin(req, res);
  if (!admin) return;
  const sourceActionId = String(req.body?.sourceActionId || "");
  const companionId = String(req.body?.companionId || "");
  if (!Types.ObjectId.isValid(sourceActionId) || !Types.ObjectId.isValid(companionId)) {
    return res.status(400).json({ error: "Valid sourceActionId and companionId are required." });
  }

  await mongooseConnect();
  const [source, companion] = await Promise.all([
    RecruitingSocialAction.findOne({ _id: sourceActionId, ownerEmail: admin.email, status: "simulated" }).lean() as any,
    RecruitingCompanion.findOne({ _id: companionId, ownerEmail: admin.email, enabled: true, pairedAt: { $ne: null } }).lean() as any,
  ]);
  if (!source) return res.status(404).json({ error: "Validated simulation action not found." });
  if (!companion) return res.status(404).json({ error: "Paired companion not found." });
  if (!companion.allowedPlatforms?.includes(source.platform)) return res.status(400).json({ error: "Companion is not authorized for this platform." });

  const idempotencyKey = createHash("sha256")
    .update([String(source._id), String(companion._id), source.recipientLock].join("|"))
    .digest("hex");
  const job = await RecruitingCompanionJob.findOneAndUpdate(
    { ownerEmail: admin.email, idempotencyKey },
    {
      $setOnInsert: {
        ownerEmail: admin.email,
        campaignId: source.campaignId,
        sourceActionId: source._id,
        companionId: companion._id,
        platform: source.platform,
        actionType: source.actionType,
        targetSnapshot: source.targetSnapshot,
        recipientLock: source.recipientLock,
        message: source.message || "",
        idempotencyKey,
        sequence: 0,
        status: "queued",
        availableAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
  await RecruitingAuditEvent.updateOne(
    { ownerEmail: admin.email, eventType: "action_queued", entityId: String(job._id) },
    {
      $setOnInsert: {
        ownerEmail: admin.email,
        actorEmail: admin.email,
        eventType: "action_queued",
        entityType: "companion_job",
        entityId: String(job._id),
        details: { sourceActionId, companionId, recipientLock: source.recipientLock },
      },
    },
    { upsert: true },
  );
  return res.status(201).json({ job });
}

import type { NextApiRequest, NextApiResponse } from "next";
import mongooseConnect from "@/lib/mongooseConnect";
import {
  COMPANION_CONSENT_VERSION,
  createDeviceToken,
  DEFAULT_COMPANION_TIME_ZONE,
  hashCompanionSecret,
  isValidTimeZone,
} from "@/lib/recruiting/companion/security";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCompanion from "@/models/RecruitingCompanion";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const pairingCode = String(req.body?.pairingCode || "").trim().toUpperCase();
  const installationId = String(req.body?.installationId || "").trim();
  const consentVersion = String(req.body?.consentVersion || "");
  const consentAccepted = req.body?.consentAccepted === true;
  const extensionVersion = String(req.body?.extensionVersion || "").slice(0, 40);
  const requestedTimeZone = String(req.body?.timeZone || "").trim();
  const timeZone = isValidTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_COMPANION_TIME_ZONE;
  if (!/^[A-F0-9]{12}$/.test(pairingCode)) return res.status(400).json({ error: "Invalid pairing code." });
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(installationId)) return res.status(400).json({ error: "Invalid installation ID." });
  if (!consentAccepted || consentVersion !== COMPANION_CONSENT_VERSION) {
    return res.status(400).json({ error: "The current companion agreement must be accepted." });
  }

  await mongooseConnect();
  const deviceToken = createDeviceToken();
  const now = new Date();
  const companion = await RecruitingCompanion.findOneAndUpdate(
    {
      pairingCodeHash: hashCompanionSecret(pairingCode),
      pairingExpiresAt: { $gt: now },
      pairedAt: null,
      enabled: true,
    },
    {
      $set: {
        installationId,
        pairedAt: now,
        tokenHash: hashCompanionSecret(deviceToken),
        consentVersion,
        consentAcceptedAt: now,
        extensionVersion,
        timeZone,
        lastSeenAt: now,
        paused: true,
      },
    },
    { new: true },
  );
  if (!companion) return res.status(400).json({ error: "Pairing code is expired, invalid, or already used." });

  await RecruitingAuditEvent.create({
    ownerEmail: companion.ownerEmail,
    actorEmail: companion.ownerEmail,
    eventType: "companion_paired",
    entityType: "companion",
    entityId: String(companion._id),
    details: { installationId, consentVersion, extensionVersion, timeZone },
  });
  return res.status(200).json({
    deviceToken,
    companion: {
      id: companion._id,
      label: companion.label,
      paused: companion.paused,
      allowedPlatforms: companion.allowedPlatforms,
      dailyActionLimit: companion.dailyActionLimit,
    },
  });
}

import { createHash } from "crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { authenticateCompanion } from "@/lib/recruiting/companion/auth";
import {
  applyEngagementAudiencePreference,
  applyAdultSafetyGate,
  actionsForConfidence,
  qualifyRecruitingCandidates,
  RECRUITING_QUALIFICATION_MODEL,
} from "@/lib/recruiting/qualification";
import { createSimulationDraft, normalizeProfileUrl } from "@/lib/recruiting/social/policy";
import type { SocialActionType, SocialPlatform } from "@/lib/recruiting/social/types";
import { enabledActionsForPlatform, normalizePlatformActionSettings } from "@/lib/recruiting/action-settings";
import { hasUnitedStatesLocationEvidence } from "@/lib/recruiting/social/us-location";
import RecruitingAuditEvent from "@/models/RecruitingAuditEvent";
import RecruitingCampaign from "@/models/RecruitingCampaign";
import RecruitingCompanionJob from "@/models/RecruitingCompanionJob";
import RecruitingDiscoveryJob from "@/models/RecruitingDiscoveryJob";
import RecruitingProspect from "@/models/RecruitingProspect";
import RecruitingSocialAction from "@/models/RecruitingSocialAction";

type NormalizedCandidate = {
  candidateId: string;
  profileUrl: string;
  displayName: string;
  evidence: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const companion = await authenticateCompanion(req);
  if (!companion) return res.status(401).json({ error: "Invalid companion token." });
  const discovery = await RecruitingDiscoveryJob.findOne({
    _id: String(req.body?.jobId || ""),
    companionId: companion._id,
    status: "claimed",
    leaseExpiresAt: { $gte: new Date() },
  });
  if (!discovery) return res.status(409).json({ error: "Discovery lease is missing or expired." });
  const campaign = await RecruitingCampaign.findOne({ _id: discovery.campaignId, ownerEmail: companion.ownerEmail, status: "active" }).lean() as any;
  if (!campaign) return res.status(409).json({ error: "Campaign is no longer active." });

  const platform = discovery.platform as SocialPlatform;
  const configuredActions = enabledActionsForPlatform(normalizePlatformActionSettings(campaign.platformActionSettings), platform);
  const rawCandidates = Array.isArray(req.body?.candidates) ? req.body.candidates.slice(0, discovery.maxCandidatesPerScan) : [];
  const candidates: NormalizedCandidate[] = [];
  for (const [index, raw] of rawCandidates.entries()) {
    try {
      const profileUrl = normalizeProfileUrl(platform, String(raw?.profileUrl || ""));
      const displayName = String(raw?.displayName || "").trim().slice(0, 120);
      const evidence = String(raw?.evidence || "").trim().slice(0, 800);
      if (displayName.length < 2 || !hasUnitedStatesLocationEvidence(evidence)) continue;
      candidates.push({ candidateId: `candidate_${index}`, profileUrl, displayName, evidence });
    } catch {
      // Invalid or ambiguous profile URLs are never sent to qualification or execution.
    }
  }

  let qualificationError = "";
  let qualifications = new Map<string, Awaited<ReturnType<typeof qualifyRecruitingCandidates>>[number]>();
  try {
    const result = await qualifyRecruitingCandidates({
      platform,
      audienceDescription: String(discovery.audienceDescription || ""),
      location: String(discovery.location || ""),
      candidates: candidates.map(({ candidateId, displayName, evidence }) => ({
        candidateId,
        evidence: evidence.replaceAll(displayName, "").trim(),
      })),
    });
    qualifications = new Map(result.map((qualification) => [qualification.candidateId, qualification]));
  } catch {
    qualificationError = "Audience matching could not be completed.";
  }

  let accepted = 0;
  const derivedSeedAccounts = new Set<string>((Array.isArray(discovery.derivedSeedAccounts) ? discovery.derivedSeedAccounts : []).map(String));
  for (const candidate of candidates) {
    try {
      const qualification = qualifications.get(candidate.candidateId);
      if (!qualification) continue;
      if (platform === "instagram" && qualification.adultSafety === "adult_verified" && qualification.confidenceTier !== "low") {
        derivedSeedAccounts.add(candidate.profileUrl);
      }
      const capturedAt = new Date().toISOString();
      const externalRecipientId = createHash("sha256").update(`${platform}|${candidate.profileUrl}`).digest("hex");
      const personalized = String(campaign.openingMessage || "").replaceAll("{{firstName}}", candidate.displayName.split(/\s+/)[0] || "there");
      let supportedActions = applyEngagementAudiencePreference(
        applyAdultSafetyGate(actionsForConfidence(platform, qualification.confidenceTier), qualification.adultSafety),
        campaign.engagementAudience || "everyone",
        candidate.evidence,
      )
        .filter((action) => configuredActions.includes(action)) as SocialActionType[];
      const priorCoveDm = await RecruitingCompanionJob.exists({
        ownerEmail: companion.ownerEmail,
        platform,
        actionType: "dm",
        "targetSnapshot.profileUrl": candidate.profileUrl,
        status: { $in: ["queued", "claimed", "succeeded", "skipped"] },
      });
      if (priorCoveDm) supportedActions = supportedActions.filter((action) => action !== "dm");

      const target = {
        platform,
        externalRecipientId,
        profileUrl: candidate.profileUrl,
        displayName: candidate.displayName,
        headline: candidate.evidence,
        capturedAt,
      };
      const lockAction = supportedActions[0] || "like_post";
      const firstDraft = createSimulationDraft({ campaignId: String(campaign._id), actionType: lockAction, target });
      const prospect = await RecruitingProspect.findOneAndUpdate(
        { ownerEmail: companion.ownerEmail, platform, externalRecipientId },
        {
          $setOnInsert: { ownerEmail: companion.ownerEmail, platform, externalRecipientId },
          $set: {
            campaignId: campaign._id,
            profileUrl: candidate.profileUrl,
            displayName: candidate.displayName,
            headline: candidate.evidence,
            publicFitEvidence: qualification.evidence,
            fitReason: qualification.reason,
            confidenceScore: qualification.confidenceScore,
            confidenceTier: qualification.confidenceTier,
            qualificationModel: RECRUITING_QUALIFICATION_MODEL,
            recipientLock: firstDraft.recipientLock,
            snapshotCapturedAt: new Date(capturedAt),
            status: supportedActions.length ? "queued" : "archived",
          },
        },
        { upsert: true, new: true },
      );
      if (!supportedActions.length) continue;

      for (const [sequence, actionType] of supportedActions.entries()) {
        const draft = createSimulationDraft({ campaignId: String(campaign._id), actionType, target, message: actionType === "dm" ? personalized : undefined });
        const source = await RecruitingSocialAction.findOneAndUpdate(
          { ownerEmail: companion.ownerEmail, idempotencyKey: draft.idempotencyKey },
          {
            $setOnInsert: {
              ownerEmail: companion.ownerEmail,
              campaignId: campaign._id,
              prospectId: prospect._id,
              platform,
              actionType,
              executionMode: "simulation",
              targetSnapshot: draft.target,
              recipientLock: draft.recipientLock,
              message: draft.message || "",
              idempotencyKey: draft.idempotencyKey,
              status: "simulated",
              providerRequestMade: false,
              validationSummary: `AI qualification: ${qualification.confidenceTier} confidence (${qualification.confidenceScore.toFixed(2)}). Adult safety: ${qualification.adultSafety}.`,
            },
          },
          { upsert: true, new: true },
        );
        const jobKey = createHash("sha256").update(`${source._id}|${companion._id}|${draft.recipientLock}`).digest("hex");
        const job = await RecruitingCompanionJob.findOneAndUpdate(
          { ownerEmail: companion.ownerEmail, idempotencyKey: jobKey },
          {
            $setOnInsert: {
              ownerEmail: companion.ownerEmail,
              campaignId: campaign._id,
              sourceActionId: source._id,
              companionId: companion._id,
              platform,
              actionType,
              targetSnapshot: draft.target,
              recipientLock: draft.recipientLock,
              message: draft.message || "",
              idempotencyKey: jobKey,
              sequence,
              status: "queued",
              availableAt: platform === "linkedin" && actionType === "dm" && supportedActions.includes("connect")
                ? new Date(Date.now() + 24 * 60 * 60 * 1000)
                : new Date(),
            },
          },
          { upsert: true, new: true },
        );
        await RecruitingAuditEvent.updateOne(
          { ownerEmail: companion.ownerEmail, eventType: "action_queued", entityId: String(job._id) },
          { $setOnInsert: { ownerEmail: companion.ownerEmail, actorEmail: companion.ownerEmail, eventType: "action_queued", entityType: "companion_job", entityId: String(job._id), details: { discoveredAutomatically: true, platform, actionType, confidenceTier: qualification.confidenceTier, confidenceScore: qualification.confidenceScore, adultSafety: qualification.adultSafety, sequence } } },
          { upsert: true },
        );
      }
      accepted += 1;
    } catch {
      // A malformed, unsupported, or ambiguous candidate is skipped instead of guessed.
    }
  }

  discovery.status = "queued";
  discovery.availableAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  discovery.leaseExpiresAt = null as any;
  discovery.lastCompletedAt = new Date();
  discovery.sourceCursor = Math.max(0, Number(discovery.sourceCursor || 0)) + 1;
  discovery.derivedSeedAccounts = [...derivedSeedAccounts].slice(-500);
  discovery.lastCandidateCount = accepted;
  discovery.lastError = (qualificationError || String(req.body?.error || "")).slice(0, 300);
  await discovery.save();
  return res.status(200).json({ accepted, nextScanAt: discovery.availableAt });
}

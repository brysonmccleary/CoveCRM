import { createHash } from "crypto";
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
import RecruitingProspect from "@/models/RecruitingProspect";
import RecruitingSocialAction from "@/models/RecruitingSocialAction";
import type { DiscoveredCandidate } from "./automation";

export async function completeHostedDiscovery(params: {
  ownerEmail: string;
  cloudAccountId: any;
  discovery: any;
  rawCandidates: DiscoveredCandidate[];
  browserError?: string;
}) {
  const { ownerEmail, cloudAccountId, discovery } = params;
  const campaign = await RecruitingCampaign.findOne({ _id: discovery.campaignId, ownerEmail, status: "active" }).lean() as any;
  if (!campaign) throw new Error("Campaign is no longer active.");
  const platform = discovery.platform as SocialPlatform;
  const configuredActions = enabledActionsForPlatform(normalizePlatformActionSettings(campaign.platformActionSettings), platform);
  const candidates: Array<DiscoveredCandidate & { candidateId: string }> = [];
  for (const [index, raw] of params.rawCandidates.slice(0, discovery.maxCandidatesPerScan).entries()) {
    try {
      const profileUrl = normalizeProfileUrl(platform, String(raw.profileUrl || ""));
      const displayName = String(raw.displayName || "").trim().slice(0, 120);
      const evidence = String(raw.evidence || "").trim().slice(0, 800);
      if (displayName.length < 2 || !hasUnitedStatesLocationEvidence(evidence)) continue;
      candidates.push({ candidateId: `candidate_${index}`, profileUrl, displayName, evidence });
    } catch {
      // Invalid targets fail closed before AI qualification.
    }
  }

  let qualificationError = "";
  let qualifications = new Map<string, Awaited<ReturnType<typeof qualifyRecruitingCandidates>>[number]>();
  try {
    const result = await qualifyRecruitingCandidates({
      platform,
      audienceDescription: String(discovery.audienceDescription || ""),
      location: String(discovery.location || ""),
      candidates: candidates.map(({ candidateId, displayName, evidence }) => ({ candidateId, evidence: evidence.replaceAll(displayName, "").trim() })),
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
      ).filter((action) => configuredActions.includes(action)) as SocialActionType[];
      const priorCoveDm = await RecruitingCompanionJob.exists({
        ownerEmail,
        platform,
        actionType: "dm",
        "targetSnapshot.profileUrl": candidate.profileUrl,
        status: { $in: ["queued", "claimed", "succeeded", "skipped"] },
      });
      if (priorCoveDm) supportedActions = supportedActions.filter((action) => action !== "dm");

      const target = { platform, externalRecipientId, profileUrl: candidate.profileUrl, displayName: candidate.displayName, headline: candidate.evidence, capturedAt };
      const lockAction = supportedActions[0] || "like_post";
      const firstDraft = createSimulationDraft({ campaignId: String(campaign._id), actionType: lockAction, target });
      const prospect = await RecruitingProspect.findOneAndUpdate(
        { ownerEmail, platform, externalRecipientId },
        {
          $setOnInsert: { ownerEmail, platform, externalRecipientId },
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
          { ownerEmail, idempotencyKey: draft.idempotencyKey },
          {
            $setOnInsert: {
              ownerEmail,
              campaignId: campaign._id,
              prospectId: prospect._id,
              platform,
              actionType,
              executionMode: "hosted_cloud",
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
        const jobKey = createHash("sha256").update(`${source._id}|${cloudAccountId}|${draft.recipientLock}`).digest("hex");
        const job = await RecruitingCompanionJob.findOneAndUpdate(
          { ownerEmail, idempotencyKey: jobKey },
          {
            $setOnInsert: {
              ownerEmail,
              campaignId: campaign._id,
              sourceActionId: source._id,
              cloudAccountId,
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
          { ownerEmail, eventType: "action_queued", entityId: String(job._id) },
          { $setOnInsert: { ownerEmail, actorEmail: ownerEmail, eventType: "action_queued", entityType: "cloud_job", entityId: String(job._id), details: { hostedCloud: true, platform, actionType, confidenceTier: qualification.confidenceTier, confidenceScore: qualification.confidenceScore, adultSafety: qualification.adultSafety, sequence } } },
          { upsert: true },
        );
      }
      accepted += 1;
    } catch {
      // Any inconsistent candidate is isolated and skipped.
    }
  }

  discovery.status = "queued";
  discovery.availableAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  discovery.leaseExpiresAt = null;
  discovery.lastCompletedAt = new Date();
  discovery.sourceCursor = Math.max(0, Number(discovery.sourceCursor || 0)) + 1;
  discovery.derivedSeedAccounts = [...derivedSeedAccounts].slice(-500);
  discovery.lastCandidateCount = accepted;
  discovery.lastError = (qualificationError || params.browserError || "").slice(0, 300);
  await discovery.save();
  return { accepted, nextScanAt: discovery.availableAt };
}

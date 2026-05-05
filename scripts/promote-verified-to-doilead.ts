// scripts/promote-verified-to-doilead.ts
// Promotes verified DOI agent emails into the DOILead pool.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOILead from "../models/DOILead";
import DOIAgent from "../models/DOIAgent";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import EmailVerification from "../models/EmailVerification";
import DOIOutcome from "../models/DOIOutcome";
import EmailEngagement from "../models/EmailEngagement";
import { calculateLeadScore } from "../lib/doi/leadScore";
import { toTrustBand } from "../lib/doi/domainTrust";
import { calculateDeliverabilityScore } from "../lib/doi/deliverabilityScore";
import { DOI_CONFIG } from "./doi-config";

const MIN_BEST_EMAIL_CONFIDENCE = Math.max(70, DOI_CONFIG.minPromotionConfidence || 0);
const MIN_IDENTITY_SCORE = 60;
const normalizeLaneType = (type?: string | null) => (type === "personal" ? "personal" : "work");

type PromoteSummary = {
  processed: number;
  promoted: number;
  skipped: number;
  reasons: Record<string, number>;
};

async function resolveAgent(agentId: string) {
  return DOIAgent.findById(agentId).lean();
}

type LeadScoreResult = ReturnType<typeof calculateLeadScore>;

type PromotionContext = {
  agent?: any;
  verification?: any;
  leadScoreResult?: LeadScoreResult;
  deliverabilityScore?: number;
};

async function promoteFromBestEmail(enrichment: any, context?: PromotionContext) {
  const agent = context?.agent || (await resolveAgent(String(enrichment.agentId)));
  if (!agent) return { ok: false, reason: "missing_agent" };
  if (agent.enrichmentStatus === "enriched") return { ok: false, reason: "already_enriched" };

  if (!enrichment?.bestEmail) return { ok: false, reason: "no_best_email" };
  if ((enrichment.bestEmailConfidence || 0) < MIN_BEST_EMAIL_CONFIDENCE) {
    return { ok: false, reason: "low_best_email_confidence" };
  }

  const verification =
    context?.verification ||
    (await EmailVerification.findOne({
      agentId: agent._id,
      email: enrichment.bestEmail,
      smtpValid: true,
      verificationStatus: "valid",
    })
      .select("confidenceScore emailType catchAllSuspected smtpReason")
      .lean());

  if (!verification) {
    return { ok: false, reason: "best_email_not_verified" };
  }

  const bestEmailType = normalizeLaneType(enrichment.bestEmailType || verification.emailType || "work");

  if (bestEmailType === "work" && (agent.identityScore || 0) < MIN_IDENTITY_SCORE) {
    return { ok: false, reason: "low_identity_score" };
  }

  const confidenceScore = Math.max(enrichment.bestEmailConfidence || 0, verification.confidenceScore || 0);
  const leadScoreResult =
    context?.leadScoreResult ||
    calculateLeadScore({
      identityScore: agent.identityScore || 0,
      bestEmailConfidence: confidenceScore,
      emailType: bestEmailType,
      domainTrustLevel: toTrustBand(agent.domainTrustLevel),
      hasPhone: Boolean(agent.phone),
      hasWebsite: Boolean(agent.agencyWebsite || agent.agencyDomain),
      yearsLicensed: (agent as any)?.yearsLicensed || 0,
      multiStateLicensed: Boolean((agent as any)?.multiStateLicensed),
      catchAllSuspected: Boolean(verification.catchAllSuspected),
    });
  const deliverabilityScore =
    context?.deliverabilityScore ||
    (await calculateDeliverabilityScore({
      email: enrichment.bestEmail,
      domain: agent.agencyDomain || "",
      domainTrustLevel: agent.domainTrustLevel,
      catchAllSuspected: Boolean(verification.catchAllSuspected),
      smtpReason: verification.smtpReason || "",
    }));

  const existingLead = await DOILead.findOne({ email: enrichment.bestEmail }).select("_id").lean();
  if (existingLead) return { ok: false, reason: "duplicate_email" };

  const hasPhone = Boolean(agent.phone);
  const hasWebsite = Boolean(agent.agencyWebsite || agent.agencyDomain);
  const yearsLicensed = agent.yearsLicensed || 0;
  const multiStateLicensed = Boolean(agent.multiStateLicensed);
  const domainTrustLevel = agent.domainTrustLevel || "";

  const writeResult = await DOILead.updateOne(
    { email: enrichment.bestEmail },
    {
      $setOnInsert: {
        firstName: agent.firstName,
        lastName: agent.lastName,
        phone: agent.phone,
        state: agent.state,
        licenseType: agent.licenseType,
        licenseNumber: agent.licenseNumber,
        licenseStatus: agent.licenseStatus,
        source: "DOI-Enrichment-Verified",
        scrapedAt: new Date(),
        assignedCount: 0,
        globallyUnsubscribed: false,
        platformPromoStatus: "pending",
        platformPromoAttempts: 0,
        platformPromoReason: "",
        platformPromoSentAt: null,
        platformPromoLastAttemptAt: null,
        platformPromoStep: 0,
        platformPromoNextAt: new Date(),
        platformPromoCompletedAt: null,
        bestEmail: enrichment.bestEmail,
        emailType: bestEmailType,
        bestEmailType,
        confidenceScore,
        bestEmailConfidence: enrichment.bestEmailConfidence || confidenceScore,
        identityScore: agent.identityScore || 0,
        domain: agent.agencyDomain || "",
        agency: agent.agencyName || "",
        leadScore: leadScoreResult.leadScore,
        leadGrade: leadScoreResult.leadGrade,
        domainTrustLevel,
        hasPhone,
        hasWebsite,
        yearsLicensed,
        multiStateLicensed,
        deliverabilityScore,
        engagementScore: leadScoreResult.engagementScore,
      },
    },
    { upsert: true }
  );

  if (!writeResult.upsertedCount) {
    return { ok: false, reason: "race_condition" };
  }

  const leadDoc = await DOILead.findOne({ email: enrichment.bestEmail }).lean();

  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        enrichmentStatus: "enriched",
        lastCheckedAt: new Date(),
        lastEnrichedAt: new Date(),
        pipelineStage: "promoted",
        stuckReason: "",
        leadScore: leadScoreResult.leadScore,
        leadGrade: leadScoreResult.leadGrade,
        engagementScore: leadScoreResult.engagementScore,
        deliverabilityScore,
      },
    }
  );
  await DOIAgentEnrichment.updateOne(
    { agentId: agent._id },
    {
      $set: {
        stage: "verified",
        notes: `Promoted to DOILead (${bestEmailType})`,
      },
    },
    { upsert: true }
  );

  await EmailVerification.updateOne(
    { agentId: agent._id, email: enrichment.bestEmail },
    { $set: { reasonBucket: "", rejectionReason: "" } }
  );

  await DOIOutcome.create({
    agentId: agent._id,
    email: enrichment.bestEmail,
    doiLeadId: leadDoc?._id,
    eventType: "promoted",
    eventSource: "doi_pipeline",
    notes: `Confidence=${confidenceScore}; Identity=${agent.identityScore || 0}; Type=${bestEmailType}`,
  });

  return { ok: true };
}

export async function promoteVerifiedAgents(limit = DOI_CONFIG.promotionBatchSize): Promise<PromoteSummary> {
  const enrichments = await DOIAgentEnrichment.find({
    bestEmail: { $exists: true, $ne: "" },
    bestEmailConfidence: { $gte: MIN_BEST_EMAIL_CONFIDENCE },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const candidates: Array<{
    enrichment: any;
    agent?: any;
    verification?: any;
    leadScoreResult: LeadScoreResult;
    engagement?: any;
    deliverabilityScore: number;
  }> = [];

  for (const enrichment of enrichments) {
    const agent = await resolveAgent(String(enrichment.agentId));
    let verification = null;
    let engagement = null;
    let deliverabilityScore = 50;
    if (agent && enrichment.bestEmail) {
      verification = await EmailVerification.findOne({
        agentId: agent._id,
        email: enrichment.bestEmail,
        smtpValid: true,
        verificationStatus: "valid",
      })
        .select("confidenceScore emailType catchAllSuspected smtpReason")
        .lean();

      engagement = await EmailEngagement.findOne({ agentId: agent._id }).lean();

      if (verification) {
        deliverabilityScore = await calculateDeliverabilityScore({
          email: enrichment.bestEmail,
          domain: agent.agencyDomain || "",
          domainTrustLevel: agent.domainTrustLevel,
          catchAllSuspected: Boolean(verification.catchAllSuspected),
          smtpReason: verification.smtpReason || "",
        });
      }
    }

    const normalizedLane = normalizeLaneType(
      (enrichment.bestEmailType || verification?.emailType || "work") as string
    );
    const leadScoreResult =
      agent && verification
        ? calculateLeadScore({
            identityScore: agent.identityScore || 0,
            bestEmailConfidence: Math.max(enrichment.bestEmailConfidence || 0, verification.confidenceScore || 0),
            emailType: normalizedLane,
            domainTrustLevel: toTrustBand(agent.domainTrustLevel),
            hasPhone: Boolean(agent.phone),
            hasWebsite: Boolean(agent.agencyWebsite || agent.agencyDomain),
            yearsLicensed: (agent as any)?.yearsLicensed || 0,
            multiStateLicensed: Boolean((agent as any)?.multiStateLicensed),
            catchAllSuspected: Boolean(verification.catchAllSuspected),
            engagementOpened: Boolean(engagement?.opened),
            engagementClicked: Boolean(engagement?.clicked),
            engagementReplied: Boolean(engagement?.replied),
            engagementUnsubscribed: Boolean(engagement?.unsubscribed),
          })
        : calculateLeadScore({ identityScore: 0, bestEmailConfidence: 0 });

    candidates.push({ enrichment, agent, verification, leadScoreResult, engagement, deliverabilityScore });
  }

  candidates.sort((a, b) => b.leadScoreResult.leadScore - a.leadScoreResult.leadScore);

  const summary: PromoteSummary = {
    processed: enrichments.length,
    promoted: 0,
    skipped: 0,
    reasons: {},
  };

  for (const candidate of candidates) {
    try {
      const result = await promoteFromBestEmail(candidate.enrichment, {
        agent: candidate.agent,
        verification: candidate.verification,
        leadScoreResult: candidate.leadScoreResult,
        deliverabilityScore: candidate.deliverabilityScore,
      });
      if (result.ok) summary.promoted += 1;
      else {
        summary.skipped += 1;
        const reason = result.reason || "unknown";
        summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
      }
    } catch (err) {
      console.error("[promote-doi-leads] Failed to promote enrichment", candidate?.enrichment?.bestEmail, err);
      summary.skipped += 1;
      summary.reasons["error"] = (summary.reasons["error"] || 0) + 1;
    }
  }

  return summary;
}

export async function promoteAgentById(agentId: string) {
  const enrichment = await DOIAgentEnrichment.findOne({ agentId }).lean();
  if (!enrichment) return { ok: false, reason: "no_enrichment" };
  return promoteFromBestEmail(enrichment);
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const result = await promoteVerifiedAgents();
    console.log(
      `[promote-doi-leads] processed=${result.processed} promoted=${result.promoted} skipped=${result.skipped}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[promote-doi-leads] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

import DOIAgent from "../../models/DOIAgent";
import DOIAgentEnrichment from "../../models/DOIAgentEnrichment";
import DOILead from "../../models/DOILead";
import EmailVerification from "../../models/EmailVerification";
import EmailEngagement from "../../models/EmailEngagement";
import { calculateLeadScore } from "./leadScore";
import { calculateDeliverabilityScore } from "./deliverabilityScore";
import { toTrustBand } from "./domainTrust";

export async function recomputeAgentQuality(agentId: string) {
  const agent = await DOIAgent.findById(agentId).lean();
  if (!agent) return { ok: false, reason: "missing_agent" };

  const enrichment = await DOIAgentEnrichment.findOne({ agentId }).lean();
  if (!enrichment?.bestEmail) return { ok: false, reason: "no_best_email" };

  const verification = await EmailVerification.findOne({
    agentId,
    email: enrichment.bestEmail,
    smtpValid: true,
    verificationStatus: "valid",
  })
    .sort({ confidenceScore: -1 })
    .lean();
  if (!verification) return { ok: false, reason: "best_email_not_verified" };

  const engagement = await EmailEngagement.findOne({ agentId }).lean();

  const leadScoreResult = calculateLeadScore({
    identityScore: agent.identityScore || 0,
    bestEmailConfidence: Math.max(enrichment.bestEmailConfidence || 0, verification.confidenceScore || 0),
    emailType: (enrichment.bestEmailType || verification.emailType || "domain") as "domain" | "personal",
    domainTrustLevel: toTrustBand(agent.domainTrustLevel),
    hasPhone: Boolean(agent.phone),
    hasWebsite: Boolean(agent.agencyWebsite || agent.agencyDomain),
    yearsLicensed: agent.yearsLicensed || 0,
    multiStateLicensed: Boolean(agent.multiStateLicensed),
    catchAllSuspected: Boolean(verification.catchAllSuspected),
    engagementOpened: Boolean(engagement?.opened),
    engagementClicked: Boolean(engagement?.clicked),
    engagementReplied: Boolean(engagement?.replied),
    engagementUnsubscribed: Boolean(engagement?.unsubscribed),
  });

  const deliverabilityScore = await calculateDeliverabilityScore({
    email: enrichment.bestEmail,
    domain: agent.agencyDomain || "",
    domainTrustLevel: agent.domainTrustLevel,
    catchAllSuspected: Boolean(verification.catchAllSuspected),
    smtpReason: verification.smtpReason || "",
  });

  const now = new Date();
  await DOIAgent.updateOne(
    { _id: agentId },
    {
      $set: {
        leadScore: leadScoreResult.leadScore,
        leadGrade: leadScoreResult.leadGrade,
        engagementScore: leadScoreResult.engagementScore,
        deliverabilityScore,
        lastEnrichedAt: now,
        lastCheckedAt: now,
      },
    }
  );

  await DOILead.updateOne(
    { email: enrichment.bestEmail },
    {
      $set: {
        leadScore: leadScoreResult.leadScore,
        leadGrade: leadScoreResult.leadGrade,
        engagementScore: leadScoreResult.engagementScore,
        deliverabilityScore,
        bestEmail: enrichment.bestEmail,
        bestEmailType: enrichment.bestEmailType || verification.emailType || "domain",
        bestEmailConfidence: enrichment.bestEmailConfidence || verification.confidenceScore || 0,
        identityScore: agent.identityScore || 0,
        domainTrustLevel: agent.domainTrustLevel || "",
        hasPhone: Boolean(agent.phone),
        hasWebsite: Boolean(agent.agencyWebsite || agent.agencyDomain),
        yearsLicensed: agent.yearsLicensed || 0,
        multiStateLicensed: Boolean(agent.multiStateLicensed),
      },
    }
  );

  return { ok: true, leadScore: leadScoreResult.leadScore, deliverabilityScore };
}

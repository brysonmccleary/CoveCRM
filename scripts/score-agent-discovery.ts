// scripts/score-agent-discovery.ts
// Deterministically scores discovery candidates and accepts the strongest evidence.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import { DOI_CONFIG } from "./doi-config";
import { extractWebsiteInfo } from "./find-website";
import { generateEmailPatternsForAgent } from "./generate-email-patterns";
import { scoreDiscoveryCandidate } from "../lib/doi/scoreDiscovery";
import { classifyDomainTrust, isDomainAllowed } from "../lib/doi/domainTrust";

type ScoreSummary = {
  processed: number;
  accepted: number;
  rejected: number;
  missing: number;
};

type AcceptResult = { ok: boolean; reason?: string; domain?: string };

async function recordRejection(agentId: any, reason: string) {
  await DOIAgent.updateOne(
    { _id: agentId },
    {
      $set: { lastRejectionReason: reason },
      $addToSet: { rejectionReasons: reason },
    }
  );
}

async function acceptCandidate(agent: any, candidate: any): Promise<AcceptResult> {
  const { website, domain } = extractWebsiteInfo(candidate.candidateWebsite || candidate.sourceUrl);
  if (!domain) {
    await DOIAgentDiscovery.updateOne(
      { _id: candidate._id },
      { $set: { finalScore: candidate.finalScore, accepted: false, rejectedReason: "invalid_domain" } }
    );
    await recordRejection(agent._id, "invalid_domain");
    return { ok: false, reason: "invalid_domain" };
  }

  const trust = classifyDomainTrust(domain);
  const allowed = isDomainAllowed(trust.level, DOI_CONFIG.allowSocialDomains);
  await DOIAgentDiscovery.updateOne(
    { _id: candidate._id },
    { $set: { domainTrustLevel: trust.level } }
  );
  if (!allowed) {
    const bucket =
      trust.level === "social"
        ? "social_domain"
        : trust.level === "generic_directory"
        ? "directory_domain"
        : trust.level === "low_trust"
        ? "low_trust_domain"
        : "blacklisted_domain";
    await DOIAgentDiscovery.updateOne(
      { _id: candidate._id },
      { $set: { rejectedReason: bucket } }
    );
    await recordRejection(agent._id, bucket);
    return { ok: false, reason: bucket };
  }

  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        agencyName: candidate.candidateAgencyName || agent.agencyName || "",
        agencyWebsite: website,
        agencyDomain: domain,
        confidenceScore: candidate.finalScore,
        lastCheckedAt: new Date(),
        domainTrustLevel: trust.level,
        pipelineStage: "domain",
        stuckReason: "",
      },
    }
  );

  await DOIAgentDiscovery.updateMany(
    { agentId: agent._id },
    {
      $set: {
        accepted: false,
      },
    }
  );

  await DOIAgentDiscovery.updateOne(
    { _id: candidate._id },
    {
      $set: {
        accepted: true,
        rejectedReason: "",
        checkedAt: new Date(),
        domainTrustLevel: trust.level,
      },
    }
  );

  await DOIAgentEnrichment.updateOne(
    { agentId: agent._id },
    {
      $setOnInsert: { stage: "pending" },
      $set: {
        stage: "domain_found",
        lastAttemptAt: new Date(),
        notes: `Discovery accepted (${domain}, trust=${trust.level})`,
      },
    },
    { upsert: true }
  );

  await generateEmailPatternsForAgent({
    _id: agent._id,
    firstName: agent.firstName,
    lastName: agent.lastName,
    agencyDomain: domain,
    domainTrustLevel: trust.level,
  });

  return { ok: true, domain };
}

export async function scoreDiscoveryForAgent(
  agent: any,
  minScore = DOI_CONFIG.minDiscoveryScore
): Promise<{ accepted: boolean; reason?: string }> {
  const candidates = await DOIAgentDiscovery.find({ agentId: agent._id })
    .sort({ updatedAt: -1 })
    .lean();
  if (!candidates.length) return { accepted: false, reason: "no_candidates" };

  const manualWinner = candidates.find((c) => c.manualDecision === "approved");
  if (manualWinner) {
    manualWinner.finalScore = Math.max(manualWinner.finalScore || minScore, minScore);
    const accepted = await acceptCandidate(agent, manualWinner);
    return { accepted: accepted.ok, reason: accepted.reason };
  }

  let best: any = null;
  for (const candidate of candidates) {
    if (candidate.manualDecision === "rejected") continue;

    const { score } = scoreDiscoveryCandidate(agent, {
      matchedName: candidate.matchedName,
      matchedState: candidate.matchedState,
      matchedInsuranceTerms: candidate.matchedInsuranceTerms,
      candidateAgencyName: candidate.candidateAgencyName,
      candidateDomain: candidate.candidateDomain,
      sourceType: candidate.sourceType,
      pageTitle: candidate.candidateAgencyName,
    });
    await DOIAgentDiscovery.updateOne(
      { _id: candidate._id },
      {
        $set: {
          finalScore: score,
          checkedAt: new Date(),
          domainTrustLevel: classifyDomainTrust(candidate.candidateDomain).level,
        },
      }
    );
    if (!best || score > best.finalScore) {
      best = { ...candidate, finalScore: score };
    }
  }

  if (!best || best.finalScore < minScore) {
    await DOIAgentEnrichment.updateOne(
      { agentId: agent._id },
      {
        $set: {
          stage: "failed",
          lastAttemptAt: new Date(),
          notes: "Discovery score below threshold",
        },
      },
      { upsert: true }
    );
    await recordRejection(agent._id, "low_discovery_score");
    return { accepted: false, reason: "low_discovery_score" };
  }

  const accepted = await acceptCandidate(agent, best);
  if (!accepted.ok) {
    return { accepted: false, reason: accepted.reason };
  }
  return { accepted: true };
}

export async function scoreAgentDiscovery(limit = DOI_CONFIG.scoringBatchSize): Promise<ScoreSummary> {
  const agents = await DOIAgent.find({ enrichmentStatus: "pending" })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const summary: ScoreSummary = {
    processed: agents.length,
    accepted: 0,
    rejected: 0,
    missing: 0,
  };

  for (const agent of agents) {
    const candidates = await DOIAgentDiscovery.find({ agentId: agent._id })
      .sort({ updatedAt: -1 })
      .lean();
    if (!candidates.length) {
      summary.missing += 1;
      continue;
    }

    const accepted = await scoreDiscoveryForAgent(agent);
    if (accepted.accepted) summary.accepted += 1;
    else summary.rejected += 1;
  }

  return summary;
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await scoreAgentDiscovery();
    console.log(
      `[score-agent-discovery] processed=${summary.processed} accepted=${summary.accepted} rejected=${summary.rejected} missing=${summary.missing}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[score-agent-discovery] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

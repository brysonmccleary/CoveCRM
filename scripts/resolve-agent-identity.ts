// scripts/resolve-agent-identity.ts
// Scores parsed pages and selects the best domain for each DOI agent.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import { Types } from "mongoose";
import DOIAgent from "../models/DOIAgent";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import DOIRawRecord from "../models/DOIRawRecord";
import { DOI_CONFIG } from "./doi-config";
import { resolveIdentity } from "../lib/doi/identityResolver";
import { selectBestDomain, DomainSelectionResult } from "../lib/doi/selectBestDomain";
import { normalizeDomain } from "./normalize-domain";
import { classifyDomainTrust } from "../lib/doi/domainTrust";

const REJECT_TRUST_LEVELS = new Set([
  "social",
  "generic_directory",
  "low_trust",
  "blacklisted",
]);
const PERSONAL_FALLBACK_REASONS = new Set([
  "low_identity_score",
  "identity_low_score",
  "no_valid_domains",
  "no_candidates",
]);

const toObjectId = (value: any) => {
  if (!value) return value;
  if (value instanceof Types.ObjectId) return value;
  try {
    return new Types.ObjectId(value);
  } catch {
    return value;
  }
};

function splitFullName(fullName?: string | null) {
  const parts = (fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

async function hydrateAgentIdentityFromRaw(agent: any) {
  const agentId = toObjectId(agent._id);
  const rawRecord: any = await DOIRawRecord.findOne({ promotedAgentId: agentId })
    .sort({ updatedAt: -1 })
    .lean();

  if (!rawRecord) {
    console.log(`[identity-skip] agent=${String(agentId)} reason=no_raw_identity`);
    return;
  }

  let firstName = (agent.firstName || "").trim();
  let lastName = (agent.lastName || "").trim();
  let fullName = (agent.fullName || "").trim();

  const rawFirst = (
    rawRecord.rawFirstName ||
    rawRecord.candidateFirstName ||
    rawRecord.rawPayload?.first_name ||
    rawRecord.rawPayload?.firstName ||
    ""
  ).trim();
  const rawLast = (
    rawRecord.rawLastName ||
    rawRecord.candidateLastName ||
    rawRecord.rawPayload?.last_name ||
    rawRecord.rawPayload?.lastName ||
    ""
  ).trim();
  const rawFullName = (
    rawRecord.fullName ||
    rawRecord.rawFullName ||
    rawRecord.candidateFullName ||
    rawRecord.rawPayload?.full_name ||
    rawRecord.rawPayload?.fullName ||
    rawRecord.rawPayload?.name ||
    [rawFirst, rawLast].filter(Boolean).join(" ")
  ).trim();

  if (!firstName && !lastName && fullName) {
    const split = splitFullName(fullName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (!firstName && !lastName && rawFullName) {
    const split = splitFullName(rawFullName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (!firstName) firstName = rawFirst;
  if (!lastName) lastName = rawLast;
  if (!fullName) fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || rawFullName;

  const agencyName = (
    agent.agencyName ||
    rawRecord.candidateAgencyName ||
    rawRecord.rawPayload?.agency_name ||
    rawRecord.rawPayload?.agencyName ||
    rawRecord.rawPayload?.agency ||
    ""
  ).trim();
  const city = (
    agent.city ||
    rawRecord.rawCity ||
    rawRecord.candidateCity ||
    rawRecord.rawPayload?.city ||
    ""
  ).trim();
  const state = (
    agent.state ||
    rawRecord.state ||
    rawRecord.candidateState ||
    rawRecord.rawPayload?.state ||
    ""
  ).trim();

  console.log(
    `[identity-hydrate] agent=${String(agentId)} first="${firstName}" last="${lastName}" agency="${agencyName}" city="${city}" state="${state}"`
  );

  const set: Record<string, any> = {};
  if (!agent.firstName && firstName) set.firstName = firstName;
  if (!agent.lastName && lastName) set.lastName = lastName;
  if (!agent.fullName && fullName) set.fullName = fullName;
  if (!agent.agencyName && agencyName) set.agencyName = agencyName;
  if (!agent.city && city) set.city = city;
  if (!agent.state && state) set.state = state;

  if (Object.keys(set).length) {
    await DOIAgent.updateOne({ _id: agentId }, { $set: set });
    Object.assign(agent, set);
  }
}

function fallbackSelectDomain(agent: any, docs: any[]): DomainSelectionResult | null {
  const threshold = DOI_CONFIG.identityScoreThreshold || 60;
  const candidates = docs
    .filter((doc) => doc.rootDomain)
    .map((doc) => {
      const trust = classifyDomainTrust(doc.rootDomain || doc.url || "");
      return {
        doc,
        trust: trust.level,
        identityScore: doc.identityScore || 0,
      };
    })
    .filter((entry) => !REJECT_TRUST_LEVELS.has(entry.trust));

  if (!candidates.length) return null;

  const domainMap = new Map<string, (typeof candidates)[number]>();
  for (const entry of candidates) {
    if (!domainMap.has(entry.doc.rootDomain)) {
      domainMap.set(entry.doc.rootDomain, entry);
    }
  }
  const uniqueCandidates = Array.from(domainMap.values());

  if (uniqueCandidates.length === 1) {
    const single = uniqueCandidates[0];
    return {
      accepted: true,
      doc: single.doc,
      combinedScore: Math.max(single.identityScore, threshold),
      domainTrustLevel: single.trust,
      evidenceSummary: "fallback_unique_candidate",
    };
  }

  const sorted = [...candidates].sort(
    (a, b) => (b.identityScore || 0) - (a.identityScore || 0)
  );
  const best = sorted[0];
  const runner = sorted[1];
  if (
    (best.identityScore || 0) >= 20 &&
    (!runner || (best.identityScore || 0) - (runner.identityScore || 0) >= 15)
  ) {
    return {
      accepted: true,
      doc: best.doc,
      combinedScore: Math.max(best.identityScore, threshold),
      domainTrustLevel: best.trust,
      evidenceSummary: "fallback_dominant_candidate",
    };
  }

  return null;
}

export async function resolveIdentityForAgent(agent: any) {
  await hydrateAgentIdentityFromRaw(agent);
  const agentId = toObjectId(agent._id);
  const docs = await DOIAgentDiscovery.find({
    agentId,
    rootDomain: { $ne: "" },
    $or: [{ parsed: true }, { parsed: { $exists: false } }],
  }).lean();
  if (!docs.length) {
    if (agent.pipelineStage === "domain" && (!agent.searchResultCount || agent.searchResultCount === 0)) {
      await DOIAgent.updateOne(
        { _id: agentId },
        { $set: { stuckReason: "no_search_results", pipelineStage: "discovery" } }
      );
    }
    return { processed: 0, selected: false, flagged: false, reason: "no_docs" };
  }

  if ((!agent.searchResultCount || agent.searchResultCount === 0) && docs.length > 0) {
    await DOIAgent.updateOne(
      { _id: agentId },
      { $set: { searchResultCount: docs.length, stuckReason: "" } }
    );
  }

  const scoredDocs = [];
  for (const doc of docs) {
    const resolution = resolveIdentity(agent, doc);
    scoredDocs.push({ ...doc, ...resolution });
    await DOIAgentDiscovery.updateOne(
      { _id: doc._id },
      {
        $set: {
          identityScore: resolution.identityScore,
          identityConfidence: resolution.confidence,
          identityReasons: resolution.reasons,
        },
      }
    );
  }

  let selection = selectBestDomain(agent, scoredDocs);
  let usedFallback = false;
  if (!selection.accepted) {
    const fallbackSelection = fallbackSelectDomain(agent, scoredDocs);
    if (fallbackSelection) {
      selection = fallbackSelection;
      usedFallback = true;
    }
  }

  if (selection.accepted) {
    const agentId = toObjectId(agent._id);
    const normalized = normalizeDomain(selection.doc.url || selection.doc.rootDomain || "");
    const selectedDomain = normalized.domain || selection.doc.rootDomain || "";
    const selectedWebsite =
      normalized.website || selection.doc.url || (selectedDomain ? `https://${selectedDomain}` : "");
    if (!selectedDomain) {
      return {
        processed: scoredDocs.length,
        selected: false,
        flagged: true,
        reason: "empty_selected_domain",
      };
    }
    await DOIAgentDiscovery.updateMany(
      { agentId },
      { $set: { accepted: false } }
    );
    await DOIAgentDiscovery.updateOne(
      { _id: selection.doc._id },
      { $set: { accepted: true, finalScore: selection.combinedScore } }
    );

    const agentUpdate = await DOIAgent.updateOne(
      { _id: agentId },
      {
        $set: {
          agencyDomain: selectedDomain,
          agencyWebsite: selectedWebsite,
          agencyName:
            selection.doc.candidateAgencyName ||
            selection.doc.foundAgencyNames?.[0] ||
            agent.agencyName ||
            "",
          domainTrustLevel: selection.domainTrustLevel,
          identityScore: selection.doc.identityScore || selection.combinedScore,
          identityConfidence: selection.doc.identityConfidence || "medium",
          identityReasons: selection.doc.identityReasons || [],
          reviewNeeded: false,
          lastIdentityResolveAt: new Date(),
          evidenceSummary: selection.evidenceSummary,
          pipelineStage: "patterns",
          stuckReason: "",
          selectedDomainAt: new Date(),
          emailDiscoveryMode: "business_domain",
        },
      }
    );
    if (!agentUpdate.modifiedCount) {
      console.warn("[resolve-agent-identity] agent update skipped", agentId?.toString());
    }

    await DOIAgentEnrichment.updateOne(
      { agentId },
      {
        $set: {
          selectedDomain,
          selectedDomainScore: selection.combinedScore,
          selectedIdentityScore: selection.doc.identityScore || selection.combinedScore,
          selectedIdentityConfidence: selection.doc.identityConfidence || "medium",
          evidenceSummary: selection.evidenceSummary,
          stage: "domain_found",
          emailDiscoveryMode: "business_domain",
        },
      },
      { upsert: true }
    );
    return {
      processed: scoredDocs.length,
      selected: true,
      flagged: false,
      usedFallback,
    };
  }

  const fallbackEligible = PERSONAL_FALLBACK_REASONS.has(selection.reason || "");
  const identityScoreMax = Math.max(...docs.map((d) => d.identityScore || 0), 0);
  if (fallbackEligible) {
    await DOIAgent.updateOne(
      { _id: agentId },
      {
        $set: {
          reviewNeeded: false,
          lastIdentityResolveAt: new Date(),
          stuckReason: "",
          identityScore: identityScoreMax,
          pipelineStage: "email",
          emailDiscoveryMode: agent.emailDiscoveryMode || "personal_fallback",
        },
      }
    );
    await DOIAgentEnrichment.updateOne(
      { agentId },
      {
        $setOnInsert: { agentId },
        $set: {
          stage: "pending",
          notes: `Fallback to personal email lane (${selection.reason || "low_identity_score"})`,
          emailDiscoveryMode: "personal_fallback",
        },
      },
      { upsert: true }
    );
    console.log(
      `[resolve-agent-identity:fallback] moved agent ${String(agentId)} to email personal_fallback reason=${
        selection.reason || "low_identity_score"
      }`
    );
    return {
      processed: scoredDocs.length,
      selected: false,
      flagged: false,
      reason: selection.reason,
      usedFallback: true,
    };
  } else {
    await DOIAgent.updateOne(
      { _id: agentId },
      {
        $set: {
          reviewNeeded: true,
          lastIdentityResolveAt: new Date(),
          stuckReason: selection.reason || "identity_low_score",
          identityScore: identityScoreMax,
        },
      }
    );
  }
  return {
    processed: scoredDocs.length,
    selected: false,
    flagged: true,
    reason: selection.reason,
  };
}

export async function resolveIdentitiesBatch(limit = DOI_CONFIG.identityBatchSize) {
  const agents = await DOIAgent.find({
    agencyDomain: "",
    enrichmentStatus: { $ne: "failed" },
    pipelineStage: { $in: ["domain", "discovery"] },
    searchResultCount: { $gt: 0 },
    $or: [
      { reviewNeeded: true },
      { reviewNeeded: { $exists: false } },
      { identityScore: { $lt: DOI_CONFIG.identityScoreThreshold || 60 } },
    ],
  })
    .sort({ lastIdentityResolveAt: 1 })
    .limit(limit)
    .lean();

  let processed = 0;
  let selected = 0;
  let flagged = 0;
  let fallbackSelections = 0;
  const reasonBuckets: Record<string, number> = {};

  for (const agent of agents) {
    const result = await resolveIdentityForAgent(agent);
    if (!result.processed) continue;
    processed += 1;
    if (result.selected) selected += 1;
    if (result.usedFallback) fallbackSelections += 1;
    if (result.flagged) {
      flagged += 1;
      const key = result.reason || "unknown";
      reasonBuckets[key] = (reasonBuckets[key] || 0) + 1;
    }
  }

  return { processed, selected, flagged, fallbackSelections, reasonBuckets };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await resolveIdentitiesBatch();
    console.log(
      `[resolve-agent-identity] processed=${summary.processed} selected=${summary.selected} flagged=${summary.flagged} fallback=${summary.fallbackSelections} reasons=${JSON.stringify(
        summary.reasonBuckets
      )}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[resolve-agent-identity] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

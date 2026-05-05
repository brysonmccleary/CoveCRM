// lib/doi/selectBestDomain.ts
// Chooses the strongest domain candidate for a DOI agent.
import { DOI_CONFIG } from "../../scripts/doi-config";
import { classifyDomainTrust } from "./domainTrust";

type AgentProfile = {
  _id?: any;
  agencyName?: string | null;
};

type DiscoveryDoc = {
  _id: any;
  rootDomain?: string;
  url?: string;
  candidateAgencyName?: string;
  identityScore?: number;
  identityConfidence?: string;
  identityReasons?: string[];
  pageTitle?: string;
  snippet?: string;
  foundAgencyNames?: string[];
};

export type DomainSelectionResult =
  | {
      accepted: true;
      doc: DiscoveryDoc;
      combinedScore: number;
      domainTrustLevel: string;
      evidenceSummary: string;
    }
  | { accepted: false; reason: string };

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function selectBestDomain(agent: AgentProfile, docs: DiscoveryDoc[]): DomainSelectionResult {
  if (!docs.length) return { accepted: false, reason: "no_candidates" };

  let best: { doc: DiscoveryDoc; combinedScore: number; trust: string } | null = null;

  for (const doc of docs) {
    if (!doc.rootDomain) continue;
    const identityScore = doc.identityScore || 0;
    const trust = classifyDomainTrust(doc.rootDomain);
    let combined = identityScore;

    switch (trust.level) {
      case "trusted_business":
        combined += 10;
        break;
      case "government":
        combined += 5;
        break;
      case "generic_directory":
        combined -= 30;
        break;
      case "social":
        combined -= 35;
        break;
      case "low_trust":
        combined -= 20;
        break;
      case "blacklisted":
        combined -= 50;
        break;
      default:
        break;
    }

    if (agent.agencyName && doc.foundAgencyNames?.length) {
      const agencyLower = agent.agencyName.toLowerCase();
      if (doc.foundAgencyNames.some((candidate) => candidate.toLowerCase().includes(agencyLower))) {
        combined += 5;
      }
    }

    combined = clamp(combined);

    if (!best || combined > best.combinedScore) {
      best = { doc, combinedScore: combined, trust: trust.level };
    }
  }

  if (!best) return { accepted: false, reason: "no_valid_domains" };

  if (best.combinedScore < (DOI_CONFIG.identityScoreThreshold || 60)) {
    return { accepted: false, reason: "low_identity_score" };
  }

  const evidenceSummary =
    best.doc.identityReasons?.slice(0, 5).join(", ") ||
    `Score ${best.doc.identityScore ?? 0} trust ${best.trust}`;

  return {
    accepted: true,
    doc: best.doc,
    combinedScore: best.combinedScore,
    domainTrustLevel: best.trust,
    evidenceSummary,
  };
}

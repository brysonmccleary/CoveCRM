import { DOI_CONFIG } from "../../scripts/doi-config";
import { classifyDomainTrust } from "./domainTrust";

const INSURANCE_KEYWORDS = ["insurance", "broker", "agency", "annuities", "life", "health"];
const AGENCY_KEYWORDS = ["about", "team", "contact", "our team", "advisors"];
const DIRECTORY_HINTS = ["yelp", "yellowpages", "mapquest", "bbb.org", "angi", "superpages"];

export type DiscoveryEvidence = {
  matchedName?: boolean;
  matchedState?: boolean;
  matchedInsuranceTerms?: boolean;
  candidateAgencyName?: string;
  candidateDomain?: string;
  sourceType?: string;
  pageTitle?: string;
};

export type DiscoveryScoreResult = {
  score: number;
  reasons: string[];
};

const clamp = (val: number, min = 0, max = 100) => Math.max(min, Math.min(max, val));

export function scoreDiscoveryCandidate(
  agent: { agencyName?: string; lastName?: string },
  evidence: DiscoveryEvidence
): DiscoveryScoreResult {
  let score = 0;
  const reasons: string[] = [];
  const trust = classifyDomainTrust(evidence.candidateDomain);

  if (evidence.matchedName) {
    score += 35;
    reasons.push("exact name match");
  }
  if (evidence.matchedState) {
    score += 10;
    reasons.push("state match");
  }
  if (evidence.matchedInsuranceTerms) {
    score += 10;
    reasons.push("insurance keywords");
  }
  if (agent.agencyName && evidence.candidateAgencyName) {
    const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (norm(agent.agencyName).includes(norm(evidence.candidateAgencyName))) {
      score += 15;
      reasons.push("agency similarity");
    }
  }
  if (evidence.candidateDomain && agent.lastName) {
    if (evidence.candidateDomain.toLowerCase().includes(agent.lastName.toLowerCase())) {
      score += 10;
      reasons.push("domain contains last name");
    }
  }
  if (evidence.pageTitle) {
    const titleLower = evidence.pageTitle.toLowerCase();
    if (AGENCY_KEYWORDS.some((kw) => titleLower.includes(kw))) {
      score += 5;
      reasons.push("agency page title");
    }
  }

  if (evidence.candidateDomain && DIRECTORY_HINTS.some((hint) => evidence.candidateDomain!.includes(hint))) {
    score -= 15;
    reasons.push("directory penalty");
  }

  switch (trust.level) {
    case "generic_directory":
      score -= 20;
      reasons.push("generic-directory");
      break;
    case "low_trust":
      score -= 25;
      reasons.push("low-trust-domain");
      break;
    case "social":
      score -= 30;
      reasons.push("social-domain");
      break;
    case "blacklisted":
      score -= 60;
      reasons.push("blacklisted-domain");
      break;
    case "government":
      score += 10;
      reasons.push("gov-domain");
      break;
    default:
      break;
  }

  if (evidence.sourceType === "duckduckgo") {
    score -= 3;
  }

  score = clamp(score + DOI_CONFIG.minDiscoveryScore / 10);
  return { score: clamp(score), reasons };
}

// lib/doi/identityResolver.ts
// Scores parsed discovery pages against a DOI agent profile.
import { DOI_CONFIG } from "../../scripts/doi-config";
import { STATE_NAMES } from "./searchPlanner";
import { classifyDomainTrust } from "./domainTrust";

type AgentProfile = {
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  state?: string | null;
  agencyName?: string | null;
};

type DiscoveryEvidence = {
  rootDomain?: string;
  title?: string;
  snippet?: string;
  foundNames?: string[];
  foundAgencyNames?: string[];
  insuranceTermsFound?: string[];
  locationHints?: string[];
  isTeamPage?: boolean;
  isContactPage?: boolean;
  isAboutPage?: boolean;
};

export type IdentityResolution = {
  identityScore: number;
  confidence: "low" | "medium" | "high";
  reasons: string[];
};

const normalize = (value?: string | null) => (value || "").trim();

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export function resolveIdentity(agent: AgentProfile, evidence: DiscoveryEvidence): IdentityResolution {
  let score = 0;
  const reasons: string[] = [];

  const first = normalize(agent.firstName);
  const last = normalize(agent.lastName);
  const fullName = [first, last].filter(Boolean).join(" ");
  const city = normalize(agent.city).toLowerCase();
  const state = normalize(agent.state).toUpperCase();
  const agency = normalize(agent.agencyName).toLowerCase();

  const trust = classifyDomainTrust(evidence.rootDomain);

  if (fullName) {
    const exactMatch = (evidence.foundNames || []).some(
      (name) => name.toLowerCase() === fullName.toLowerCase()
    );
    if (exactMatch) {
      score += 45;
      reasons.push("exact name match");
    } else if (
      evidence.title?.toLowerCase().includes(fullName.toLowerCase()) ||
      evidence.snippet?.toLowerCase().includes(fullName.toLowerCase())
    ) {
      score += 25;
      reasons.push("name match in snippet/title");
    }
  }

  if (last && evidence.rootDomain?.includes(last.toLowerCase())) {
    score += 10;
    reasons.push("last name in domain");
  }

  if (state) {
    const stateName = STATE_NAMES[state]?.toLowerCase();
    const hints = (evidence.locationHints || []).map((hint) => hint.toLowerCase());
    if (hints.includes(state.toLowerCase()) || (stateName && hints.includes(stateName))) {
      score += 12;
      reasons.push("state match");
    } else if (hints.some((hint) => hint.length === 2 && hint !== state.toLowerCase())) {
      score -= 10;
      reasons.push("conflicting state");
    }
  }

  if (city) {
    const snippet = `${evidence.snippet || ""} ${evidence.title || ""}`.toLowerCase();
    if (snippet.includes(city)) {
      score += 8;
      reasons.push("city match");
    }
  }

  if (agency) {
    const match =
      (evidence.foundAgencyNames || []).some((candidate) =>
        candidate.toLowerCase().includes(agency)
      ) ||
      evidence.title?.toLowerCase().includes(agency);
    if (match) {
      score += 12;
      reasons.push("agency match");
    }
  }

  if ((evidence.insuranceTermsFound || []).length) {
    score += 6;
    reasons.push("insurance keywords");
  }

  if (evidence.isTeamPage) {
    score += 5;
    reasons.push("team page bonus");
  }
  if (evidence.isAboutPage) {
    score += 5;
    reasons.push("about page bonus");
  }

  if (evidence.isContactPage) {
    score += 4;
    reasons.push("contact page bonus");
  }

  if ((evidence.foundNames || []).length > 10) {
    score -= 15;
    reasons.push("multiple agents penalty");
  }

  switch (trust.level) {
    case "generic_directory":
      score -= 25;
      reasons.push("directory penalty");
      break;
    case "social":
      score -= 35;
      reasons.push("social penalty");
      break;
    case "low_trust":
      score -= 20;
      reasons.push("low trust domain");
      break;
    default:
      break;
  }

  const normalizedScore = clamp(score);
  let confidence: IdentityResolution["confidence"] = "low";
  if (normalizedScore >= (DOI_CONFIG.identityHighConfidence || 80)) confidence = "high";
  else if (normalizedScore >= (DOI_CONFIG.identityScoreThreshold || 60)) confidence = "medium";
  else confidence = "low";

  return { identityScore: normalizedScore, confidence, reasons };
}

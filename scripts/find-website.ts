// scripts/find-website.ts
// Helpers for normalizing websites + extracting domains for DOI agents.
import { normalizeDomain } from "./normalize-domain";

export type WebsiteInfo = {
  website: string;
  domain: string;
  rejectedReason?: string;
};

export function extractWebsiteInfo(raw: string): WebsiteInfo {
  const result = normalizeDomain(raw || "");
  return {
    website: result.website,
    domain: result.domain,
    rejectedReason: result.rejectedReason,
  };
}

export function inferDomainFromAgency(agencyName: string, state?: string): string {
  const base = (agencyName || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!base) return "";
  const suffix = state ? state.toLowerCase() : "ins";
  const guess = `${base}.${suffix}.com`;
  const normalized = normalizeDomain(guess);
  return normalized.domain;
}

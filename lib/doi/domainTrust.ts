// lib/doi/domainTrust.ts
// Centralized domain trust classification for DOI enrichment quality control.
const SOCIAL_DOMAINS = ["facebook.com", "linkedin.com", "instagram.com", "twitter.com", "x.com"];
const DIRECTORY_HINTS = ["yelp", "yellowpages", "mapquest", "angi", "bbb.org", "superpages"];
const GENERIC_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
];
const LOW_TRUST_HINTS = ["wordpress.com", "blogspot.com", "wixsite.com", "weebly.com"];

export type DomainTrustLevel =
  | "trusted_business"
  | "generic_directory"
  | "government"
  | "social"
  | "low_trust"
  | "blacklisted"
  | "unknown";

export type DomainTrustResult = {
  level: DomainTrustLevel;
  reason: string;
};

const normalize = (domain?: string) => (domain || "").trim().toLowerCase();

export function classifyDomainTrust(domain?: string): DomainTrustResult {
  const normalized = normalize(domain);
  if (!normalized) return { level: "unknown", reason: "empty" };

  if (GENERIC_EMAIL_DOMAINS.some((bad) => normalized === bad)) {
    return { level: "blacklisted", reason: "consumer-email-domain" };
  }

  if (SOCIAL_DOMAINS.some((social) => normalized.endsWith(social))) {
    return { level: "social", reason: "social-network-domain" };
  }

  if (normalized.endsWith(".gov") || normalized.includes(".state.") || normalized.endsWith(".us")) {
    return { level: "government", reason: "government-domain" };
  }

  if (DIRECTORY_HINTS.some((hint) => normalized.includes(hint))) {
    return { level: "generic_directory", reason: "directory-domain" };
  }

  if (LOW_TRUST_HINTS.some((hint) => normalized.includes(hint))) {
    return { level: "low_trust", reason: "hosted-builder" };
  }

  return { level: "trusted_business", reason: "default" };
}

export function isDomainAllowed(level: DomainTrustLevel, allowSocial = false) {
  if (level === "blacklisted") return false;
  if (level === "low_trust") return false;
  if (level === "generic_directory") return false;
  if (level === "social") return allowSocial;
  return true;
}

export function toTrustBand(level?: string | null): "high" | "medium" | "low" | "" {
  switch (level) {
    case "trusted_business":
    case "government":
      return "high";
    case "generic_directory":
    case "social":
      return "medium";
    case "low_trust":
    case "blacklisted":
      return "low";
    default:
      return "";
  }
}

import { DOI_CONFIG } from "./doi-config";

const SOCIAL_DOMAINS = new Set([
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "yelp.com",
  "yellowpages.com",
  "glassdoor.com",
  "indeed.com",
  "angieslist.com",
  "mapquest.com",
  "bing.com",
  "google.com",
  "duckduckgo.com",
]);

const INVALID_SUFFIXES = [".pdf", ".doc", ".docx"];

const GENERIC_HOSTS = ["gov", "state", "portal", "myflorida", "txapps"];

export type NormalizedDomainResult = {
  domain: string;
  website: string;
  rejectedReason?: string;
};

export function normalizeDomain(raw: string): NormalizedDomainResult {
  if (!raw) return { domain: "", website: "", rejectedReason: "empty" };
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url.replace(/^\/+/, "")}`;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.hostname) {
      return { domain: "", website: "", rejectedReason: "no_hostname" };
    }
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }
    if (INVALID_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { domain: "", website: "", rejectedReason: "invalid_suffix" };
    }
    const parts = hostname.split(".");
    if (parts.length < 2) {
      return { domain: "", website: "", rejectedReason: "invalid_domain" };
    }
    if (!DOI_CONFIG.allowSocialDomains && SOCIAL_DOMAINS.has(hostname)) {
      return { domain: "", website: "", rejectedReason: "social_domain" };
    }
    if (GENERIC_HOSTS.some((generic) => hostname.includes(generic))) {
      return { domain: "", website: "", rejectedReason: "generic_host" };
    }
    return {
      domain: hostname,
      website: `${parsed.protocol}//${hostname}${parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : ""}`,
    };
  } catch {
    return { domain: "", website: "", rejectedReason: "invalid_url" };
  }
}

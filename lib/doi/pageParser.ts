// lib/doi/pageParser.ts
// Fetches and parses web pages for DOI discovery evidence.
import { normalizeDomain } from "../../scripts/normalize-domain";
import { STATE_NAMES } from "./searchPlanner";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CoveCRM/1.0";
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX =
  /\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g;
const NAME_REGEX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
const AGENCY_KEYWORDS = ["insurance", "agency", "financial", "services", "group", "brokerage"];
const LOCATION_KEYWORDS = ["street", "suite", "road", "rd", "st", "ave", "boulevard", "blvd"];
const STATE_ABBREVS = Object.keys(STATE_NAMES);
const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
]);

export type ParsedPageData = {
  url: string;
  pageTitle: string;
  foundEmails: string[];
  personalEmails: string[];
  pageText: string;
  foundPhones: string[];
  foundNames: string[];
  foundAgencyNames: string[];
  insuranceTermsFound: string[];
  locationHints: string[];
  isTeamPage: boolean;
  isContactPage: boolean;
  isAboutPage: boolean;
  domain: string;
};

const decodeHtmlEntities = (text: string) =>
  text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

const stripHtml = (html: string) => decodeHtmlEntities(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "));

function extractUnique(matches: RegExpMatchArray | null, normalizeFn = (v: string) => v.trim()) {
  if (!matches) return [];
  const seen = new Set<string>();
  const results: string[] = [];
  for (const match of matches) {
    const normalized = normalizeFn(match);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      results.push(normalized);
    }
  }
  return results;
}

function extractAgencyCandidates(text: string) {
  const lines = text.split(/\n+/);
  const candidates: string[] = [];
  lines.forEach((line) => {
    if (AGENCY_KEYWORDS.some((kw) => line.toLowerCase().includes(kw))) {
      const cleaned = line.trim();
      if (cleaned.length > 5 && cleaned.length < 120) {
        candidates.push(cleaned);
      }
    }
  });
  return Array.from(new Set(candidates)).slice(0, 10);
}

function extractInsuranceTerms(text: string) {
  const lower = text.toLowerCase();
  return AGENCY_KEYWORDS.filter((kw) => lower.includes(kw));
}

function extractLocationHints(text: string) {
  const hints = new Set<string>();
  const lower = text.toLowerCase();
  LOCATION_KEYWORDS.forEach((kw) => {
    if (lower.includes(kw)) hints.add(kw);
  });

  const upper = text.toUpperCase();
  STATE_ABBREVS.forEach((abbr) => {
    if (upper.includes(` ${abbr} `) || upper.endsWith(` ${abbr}`) || upper.includes(`,${abbr}`)) {
      hints.add(abbr);
    }
  });

  Object.entries(STATE_NAMES).forEach(([abbr, name]) => {
    if (lower.includes(name.toLowerCase())) hints.add(abbr);
  });

  const cityMatches = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\,\s?([A-Z]{2})\b/g);
  if (cityMatches) {
    cityMatches.forEach((match) => hints.add(match));
  }

  return Array.from(hints);
}

export async function fetchAndParsePage(url: string): Promise<ParsedPageData> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch page (${response.status})`);
  }
  const html = await response.text();
  const pageTitleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const pageTitle = pageTitleMatch ? stripHtml(pageTitleMatch[1]).trim() : "";
  const text = stripHtml(html);

  const foundEmails = extractUnique(text.match(EMAIL_REGEX), (value) => value.toLowerCase());
  const personalEmails = foundEmails.filter((email) => {
    const domain = email.split("@")[1]?.toLowerCase();
    return domain ? PERSONAL_EMAIL_DOMAINS.has(domain) : false;
  });
  const foundPhones = extractUnique(text.match(PHONE_REGEX));
  const names = extractUnique(text.match(NAME_REGEX));
  const foundAgencyNames = extractAgencyCandidates(text);
  const insuranceTermsFound = extractInsuranceTerms(text);
  const locationHints = extractLocationHints(text);

  const normalized = normalizeDomain(url);

  return {
    url,
    pageTitle,
    foundEmails: foundEmails.slice(0, 10),
    personalEmails: personalEmails.slice(0, 10),
    pageText: text,
    foundPhones: foundPhones.slice(0, 10),
    foundNames: names.slice(0, 25),
    foundAgencyNames,
    insuranceTermsFound,
    locationHints,
    isTeamPage: /team/i.test(pageTitle) || /our team|meet the team/i.test(text),
    isContactPage: /contact/i.test(pageTitle) || /contact us/i.test(text),
    isAboutPage: /about/i.test(pageTitle) || /about us/i.test(text),
    domain: normalized.domain,
  };
}

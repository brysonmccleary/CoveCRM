// scripts/search-agent-web.ts
// Deterministic domain discovery for DOI agents (no external search providers).
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DOIRawRecord from "../models/DOIRawRecord";
import { DOI_CONFIG } from "./doi-config";
import { normalizeDomain } from "./normalize-domain";
import { generateSearchQueries, STATE_NAMES } from "../lib/doi/searchPlanner";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) CoveCRM/1.0";

const SEARCH_DEBUG = process.env.DOI_SEARCH_DEBUG === "true";
const debugLog = (...args: any[]) => {
  if (SEARCH_DEBUG) {
    console.log("[search-agent-web:debug]", ...args);
  }
};

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "msn.com",
  "protonmail.com",
]);
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const FALLBACK_ROLES = [
  "insurance",
  "insurance agent",
  "insurance broker",
  "advisor",
  "medicare agent",
  "life insurance",
  "health insurance",
  "contact",
  "email",
];
const EXPANSION_PATHS = [
  "contact",
  "contact-us",
  "about",
  "about-us",
  "team",
  "our-team",
  "agents",
  "staff",
  "meet-the-team",
];
const GENERIC_DOMAINS = new Set([
  "healthsherpa.com",
  "txinsurance.net",
  "txinsurance.org",
  "policygenius.com",
  "geico.com",
  "progressive.com",
  "statefarm.com",
  "allstate.com",
  "nationwide.com",
  "insureon.com",
  "selectquote.com",
  "quotewizard.com",
  "findhelp.org",
]);
const FALLBACK_SEARCH_ENDPOINT = "https://duckduckgo.com/html/";
const ROLE_KEYWORDS = FALLBACK_ROLES;
const FALLBACK_GENERIC_REASONS = new Set(["generic_no_name", "low_score"]);

type CandidateSource = {
  url: string;
  reason: string;
};

type SearchResult = {
  url: string;
  title: string;
  snippet: string;
  query: string;
  position: number;
};

type ScoredFallbackResult = SearchResult & {
  rootDomain: string;
  website: string;
  score: number;
  matchedName: boolean;
  matchedAgency: boolean;
  matchedState: boolean;
  matchedLocation: boolean;
  matchedKeywords: boolean;
  emails: {
    all: string[];
    personal: string[];
    work: string[];
  };
  rejectReason?: string;
};

type FallbackProfile = {
  firstName: string;
  lastName: string;
  fullName: string;
  city: string;
  state: string;
  agencyName: string;
};

const COMMON_SUFFIXES = ["", "insurance", "ins", "agency", "group", "services"];
const TLDs = [".com", ".net", ".org", ".agency", ".co"];
const STOP_WORDS = /(insurance|agency|agencies|group|services|llc|inc|company|co|and)/g;

const slug = (value?: string | null) =>
  (value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(STOP_WORDS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "");

const extractDomainFromEmail = (email?: string | null) => {
  if (!email) return "";
  const match = email.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})$/);
  return match ? match[1] : "";
};

const uniqueCandidates = (items: CandidateSource[]) => {
  const seen = new Set<string>();
  const result: CandidateSource[] = [];
  for (const item of items) {
    const key = item.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
};

const stripHtml = (html: string) =>
  html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const dedupeEmails = (emails: string[]) => {
  const seen = new Set<string>();
  const list: string[] = [];
  for (const email of emails || []) {
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized.includes("@")) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    list.push(normalized);
  }
  return list.slice(0, 25);
};

const extractEmailsFromText = (text: string) => {
  const matches = text.match(EMAIL_REGEX) || [];
  const all = dedupeEmails(matches);
  const personal = all.filter((email) => {
    const domain = email.split("@")[1] || "";
    return PERSONAL_EMAIL_DOMAINS.has(domain);
  });
  const personalSet = new Set(personal);
  const work = all.filter((email) => !personalSet.has(email));
  return { all, personal, work };
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

async function hydrateFallbackProfile(agent: any): Promise<FallbackProfile> {
  const rawRecord: any = await DOIRawRecord.findOne({ promotedAgentId: agent._id })
    .sort({ updatedAt: -1 })
    .lean();

  const agentFullName = (agent.fullName || "").trim();
  const rawFullName = [
    rawRecord?.rawFirstName || rawRecord?.candidateFirstName || "",
    rawRecord?.rawLastName || rawRecord?.candidateLastName || "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
  const rawFallbackFullName =
    rawRecord?.fullName ||
    rawRecord?.rawFullName ||
    rawRecord?.candidateFullName ||
    rawRecord?.rawPayload?.full_name ||
    rawRecord?.rawPayload?.name ||
    "";

  let firstName = (agent.firstName || "").trim();
  let lastName = (agent.lastName || "").trim();

  if (!firstName && !lastName && agentFullName) {
    const split = splitFullName(agentFullName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (!firstName && !lastName && rawFullName) {
    const split = splitFullName(rawFullName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (!firstName && !lastName && rawFallbackFullName) {
    const split = splitFullName(String(rawFallbackFullName));
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (!firstName) {
    firstName =
      (rawRecord?.rawFirstName || rawRecord?.candidateFirstName || rawRecord?.rawPayload?.first_name || "").trim();
  }
  if (!lastName) {
    lastName =
      (rawRecord?.rawLastName || rawRecord?.candidateLastName || rawRecord?.rawPayload?.last_name || "").trim();
  }

  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const city =
    (agent.city || rawRecord?.rawCity || rawRecord?.candidateCity || rawRecord?.rawPayload?.city || "").trim();
  const state =
    (agent.state || rawRecord?.state || rawRecord?.candidateState || rawRecord?.rawPayload?.state || "").trim();
  const agencyName =
    (
      agent.agencyName ||
      rawRecord?.candidateAgencyName ||
      rawRecord?.rawPayload?.agency_name ||
      rawRecord?.rawPayload?.agency ||
      ""
    ).trim();

  return {
    firstName,
    lastName,
    fullName,
    city,
    state,
    agencyName,
  };
}

function computeDiscoverySignals(agent: any, meta: { title?: string; snippet?: string; url?: string; domain?: string }) {
  const title = (meta.title || "").toLowerCase();
  const snippet = (meta.snippet || "").toLowerCase();
  const url = (meta.url || "").toLowerCase();
  const domain = (meta.domain || "").toLowerCase();
  const combined = `${title} ${snippet} ${url}`;
  const firstLower = (agent.firstName || "").trim().toLowerCase();
  const lastLower = (agent.lastName || "").trim().toLowerCase();
  const fullName = [firstLower, lastLower].filter(Boolean).join(" ").trim();
  const agencyLower = (agent.agencyName || "").trim().toLowerCase();
  const cityLower = (agent.city || "").trim().toLowerCase();
  const stateAbbr = (agent.state || "").trim().toUpperCase();
  const stateLower = stateAbbr.toLowerCase();
  const stateNameLower = (STATE_NAMES[stateAbbr] || "").toLowerCase();

  const matchedFullName = fullName && combined.includes(fullName);
  const matchedFirstLast = firstLower && lastLower && combined.includes(firstLower) && combined.includes(lastLower);
  const matchedName = Boolean(matchedFullName || matchedFirstLast);
  const matchedAgency = !!agencyLower && combined.includes(agencyLower);
  const matchedCity = !!cityLower && combined.includes(cityLower);
  const matchedState =
    (!!stateLower && combined.includes(stateLower)) || (!!stateNameLower && combined.includes(stateNameLower));
  const matchedLocation = matchedCity || matchedState;
  const matchedKeywords = ROLE_KEYWORDS.some((kw) => combined.includes(kw));

  let score = 0;
  if (matchedFullName) score += 65;
  else if (matchedFirstLast) score += 45;
  if (matchedAgency) score += 15;
  if (matchedLocation) score += 15;
  if (matchedKeywords) score += 10;
  if (lastLower && domain.includes(lastLower)) score += 10;

  if (GENERIC_DOMAINS.has(domain) && !matchedName) score -= 35;
  if (!matchedName && !matchedAgency && !matchedLocation) score -= 15;

  return {
    matchedName,
    matchedAgency,
    matchedLocation,
    matchedKeywords,
    matchedState,
    score,
  };
}

function buildCandidateUrls(agent: any, rawRecord: any): CandidateSource[] {
  const candidates: CandidateSource[] = [];

  const push = (input: string | undefined | null, reason: string) => {
    if (!input) return;
    let value = input.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) {
      value = `https://${value.replace(/^\/+/, "")}`;
    }
    candidates.push({ url: value, reason });
  };

  push(agent.agencyWebsite, "agency_website");
  push(agent.agencyDomain, "agency_domain");
  if (rawRecord?.candidateWebsite) push(rawRecord.candidateWebsite, "raw_candidate_website");

  const emailDomain = extractDomainFromEmail(rawRecord?.candidateEmail);
  if (emailDomain) {
    push(emailDomain, "raw_candidate_email");
    push(`www.${emailDomain}`, "raw_candidate_email_www");
  }

  const agencyName =
    agent.agencyName || rawRecord?.candidateAgencyName || `${agent.firstName || ""} ${agent.lastName || ""}`;
  const agencySlug = slug(agencyName);
  const fallbackSlug = slug(`${agent.firstName || ""}${agent.lastName || ""}`) || agencySlug;
  const citySlug = slug(agent.city);
  const stateSlug = slug(agent.state);

  const addSlugVariants = (baseSlug: string, reason: string) => {
    if (!baseSlug) return;
    for (const suffix of COMMON_SUFFIXES) {
      const base = `${baseSlug}${suffix}`.replace(/[^a-z0-9]/g, "");
      if (!base) continue;
      for (const tld of TLDs) {
        push(`${base}${tld}`, reason);
        if (stateSlug) push(`${base}${stateSlug}${tld}`, `${reason}_state`);
        if (citySlug) push(`${base}${citySlug}${tld}`, `${reason}_city`);
      }
    }
  };

  addSlugVariants(agencySlug, "agency_name_slug");
  addSlugVariants(fallbackSlug, "agent_name_slug");

  if (!agencySlug && stateSlug) {
    TLDs.forEach((tld) => push(`${stateSlug}insurance${tld}`, "state_only"));
  }

  return uniqueCandidates(candidates).slice(0, 25);
}

function buildFallbackQueries(profile: FallbackProfile): string[] {
  const plannerQueries = generateSearchQueries(profile);
  const first = (profile.firstName || "").trim();
  const last = (profile.lastName || "").trim();
  const fullName = (profile.fullName || [first, last].filter(Boolean).join(" ").trim()).trim();
  if (!fullName) return [];
  const city = (profile.city || "").trim();
  const state = (profile.state || "").trim();
  const agency = (profile.agencyName || "").trim();

  const queries = new Set<string>(plannerQueries);
  const push = (query: string | undefined) => {
    if (!query) return;
    const trimmed = query.replace(/\s+/g, " ").trim();
    if (trimmed) queries.add(trimmed);
  };

  push(`"${fullName}" insurance ${city} ${state} email`);
  push(`"${fullName}" insurance agent ${city} ${state}`);
  push(`"${fullName}" insurance broker ${city} ${state}`);
  push(`"${fullName}" insurance advisor ${city} ${state}`);
  push(`${fullName} Medicare agent ${city} ${state}`);
  push(`${fullName} life insurance agent ${city} ${state}`);
  push(`"${fullName}" contact`);
  push(`"${fullName}" phone`);
  push(`"${fullName}" email`);
  push(`"${fullName}" "@gmail.com"`);
  push(`"${fullName}" "@yahoo.com"`);
  push(`"${fullName}" "@outlook.com"`);
  push(`${fullName} insurance agent ${state} email`);
  push(`"${fullName}" insurance ${state} filetype:pdf`);

  if (agency) {
    push(`"${fullName}" "${agency}"`);
    push(`"${fullName}" "${agency}" email`);
    push(`"${fullName}" "${agency}" insurance`);
  }

  push(`"${fullName}" site:linkedin.com/in insurance`);
  push(`"${fullName}" site:facebook.com insurance`);
  push(`"${fullName}" site:instagram.com insurance`);
  push(`"${fullName}" site:twitter.com insurance`);

  return Array.from(queries).slice(0, 15);
}

async function fetchDuckDuckGoResults(query: string): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query);
  try {
    const resp = await fetch(`${FALLBACK_SEARCH_ENDPOINT}?q=${encoded}&ia=web`, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });
    if (!resp.ok) return [];
    const html = await resp.text();
    return parseDuckDuckGoResults(html).map((result, idx) => ({
      ...result,
      query,
      position: idx + 1,
    }));
  } catch (err) {
    console.warn("[fallback-search:error]", { query, error: err instanceof Error ? err.message : err });
    return [];
  }
}

function parseDuckDuckGoResults(html: string): Array<Omit<SearchResult, "query" | "position">> {
  const results: Array<Omit<SearchResult, "query" | "position">> = [];
  const blocks = html.split('result__body');
  for (let i = 1; i < blocks.length; i += 1) {
    const block = blocks[i];
    const anchorMatch = block.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchorMatch) continue;
    const url = anchorMatch[1];
    if (!/^https?:/i.test(url)) continue;
    const title = stripHtml(anchorMatch[2] || "");
    const snippetMatch =
      block.match(/class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/(a|div)>/i) ||
      block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(a|div)>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : "";
    results.push({ url, title, snippet });
    if (results.length >= 8) break;
  }
  return results;
}

function scoreFallbackResult(agent: any, result: SearchResult): ScoredFallbackResult {
  const normalized = normalizeDomain(result.url);
  const website = normalized.website || result.url;
  const domain = normalized.domain || "";
  const emails = extractEmailsFromText(`${result.title} ${result.snippet} ${result.url}`);
  const signals = computeDiscoverySignals(agent, {
    title: result.title,
    snippet: result.snippet,
    url: result.url,
    domain,
  });

  let score = signals.score;
  if (emails.all.length) score += 20;

  let rejectReason: string | undefined;
  const allowByName = signals.matchedName && score >= 15;
  if (!signals.matchedName && GENERIC_DOMAINS.has(domain)) {
    rejectReason = "generic_no_name";
  }
  if (!allowByName && score < 25) {
    rejectReason = rejectReason || "low_score";
  }

  return {
    ...result,
    rootDomain: domain,
    website,
    score,
    matchedName: signals.matchedName,
    matchedAgency: signals.matchedAgency,
    matchedState: signals.matchedState,
    matchedLocation: signals.matchedLocation,
    matchedKeywords: signals.matchedKeywords,
    emails,
    rejectReason,
  };
}

async function upsertFallbackDiscovery(agent: any, result: ScoredFallbackResult, sourceType: string) {
  if (!result.rootDomain) return false;
  const update = {
    candidateAgencyName: agent.agencyName || `${agent.firstName || ""} ${agent.lastName || ""}`.trim(),
    candidateWebsite: result.website,
    candidateDomain: result.rootDomain,
    sourceUrl: result.website,
    sourceType,
    sourceQuery: result.query,
    title: result.title,
    snippet: result.snippet,
    position: result.position,
    rootDomain: result.rootDomain,
    matchedName: result.matchedName,
    matchedState: result.matchedState,
    matchedInsuranceTerms: result.matchedKeywords,
    matchedAgency: result.matchedAgency,
    matchedLocation: result.matchedLocation,
    finalScore: result.score,
    discoveryScore: result.score,
    foundEmails: result.emails.all,
    personalEmails: result.emails.personal,
    workEmails: result.emails.work,
    isGenericJunk: false,
    fetched: false,
    parsed: false,
    fetchAttempts: 0,
    parseAttempts: 0,
    fetchFailedReason: "",
    parseFailedReason: "",
    lastFetchedAt: null,
    lastParsedAt: null,
  };

  const res = await DOIAgentDiscovery.updateOne(
    { agentId: agent._id, sourceUrl: result.website },
    {
      $set: update,
      $setOnInsert: {
        agentId: agent._id,
      },
    },
    { upsert: true }
  );

  return (res.upsertedCount || 0) > 0 || (res.matchedCount || 0) > 0;
}

async function expandHighSignalPaths(agent: any, result: ScoredFallbackResult) {
  if (result.score < 50 || !result.website) return;
  const base = result.website.replace(/\/+$/, "");
  const inserts = EXPANSION_PATHS.slice(0, 3);
  for (const path of inserts) {
    const url = `${base}/${path}`;
    await DOIAgentDiscovery.updateOne(
      { agentId: agent._id, sourceUrl: url },
      {
        $setOnInsert: {
          candidateAgencyName: result.title || agent.agencyName || "",
          sourceType: "fallback_expansion",
          rootDomain: result.rootDomain,
          candidateDomain: result.rootDomain,
          candidateWebsite: url,
          title: `${result.title} :: ${path}`,
          snippet: `Auto-expanded ${path}`,
          position: result.position,
          fetched: false,
          parsed: false,
          fetchAttempts: 0,
          parseAttempts: 0,
        },
      },
      { upsert: true }
    );
  }
}

async function collectFallbackResultsForAgent(agent: any) {
  const profile = await hydrateFallbackProfile(agent);
  console.log(
    `[fallback-profile] agent=${agent._id} first="${profile.firstName}" last="${profile.lastName}" full="${profile.fullName}" city="${profile.city}" state="${profile.state}" agency="${profile.agencyName}"`
  );
  const searchAgent = {
    ...agent,
    firstName: profile.firstName,
    lastName: profile.lastName,
    city: profile.city,
    state: profile.state,
    agencyName: profile.agencyName,
    fullName: profile.fullName,
  };
  const queries = buildFallbackQueries(profile);
  if (!queries.length) {
    console.log(`[fallback-skip] agent=${agent._id} reason=no_full_name`);
    return { saved: 0, candidates: 0 };
  }

  const seenUrls = new Set<string>();
  const scored: ScoredFallbackResult[] = [];

  for (const query of queries) {
    console.log(`[fallback-search] agent=${agent._id} query="${query}"`);
    const results = await fetchDuckDuckGoResults(query);
    for (const raw of results) {
      console.log(`[fallback-raw] agent=${agent._id} url=${raw.url} title="${raw.title}" snippet="${raw.snippet}"`);
      const key = raw.url.split("#")[0];
      if (seenUrls.has(key)) continue;
      seenUrls.add(key);
      const scoredResult = scoreFallbackResult(searchAgent, raw);
      console.log(
        `[discovery:candidate] agent=${agent._id} url=${raw.url} score=${scoredResult.score} matched_name=${
          scoredResult.matchedName ? 1 : 0
        } matched_agency=${scoredResult.matchedAgency ? 1 : 0} matched_location=${
          scoredResult.matchedLocation ? 1 : 0
        }`
      );
      scored.push(scoredResult);
      console.log(
        `[fallback-score] agent=${agent._id} url=${raw.url} score=${scoredResult.score} matched_name=${
          scoredResult.matchedName ? 1 : 0
        } matched_agency=${scoredResult.matchedAgency ? 1 : 0} matched_location=${
          scoredResult.matchedLocation ? 1 : 0
        } emails_in_snippet=${scoredResult.emails.all.length}`
      );
    }
  }

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, 5);

  let saved = 0;
  for (const result of topResults) {
    if (result.rejectReason) {
      console.log(
        `[fallback-reject] agent=${agent._id} url=${result.url} reason=${result.rejectReason} score=${result.score}`
      );
      continue;
    }
    const inserted = await upsertFallbackDiscovery(searchAgent, result, "fallback_duckduckgo");
    if (inserted) saved += 1;
    console.log(
      `[fallback-accept] agent=${agent._id} url=${result.url} score=${result.score} matched_name=${result.matchedName ? 1 : 0} sourceType=fallback_duckduckgo`
    );
    console.log(`[discovery-selected] agent=${agent._id} url=${result.url} score=${result.score}`);
    await expandHighSignalPaths(searchAgent, result);
  }

  const totalResults = await DOIAgentDiscovery.countDocuments({ agentId: agent._id });
  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        lastSearchAt: new Date(),
        searchResultCount: totalResults,
        searchQueries: queries,
        stuckReason: saved ? "" : agent.stuckReason || "",
      },
    }
  );

  return { saved, candidates: scored.length };
}

async function isReachable(url: string) {
  const controller = AbortSignal.timeout(4000);
  const headers = { "User-Agent": USER_AGENT };
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller,
      headers,
    });
    if (response.ok || (response.status >= 300 && response.status < 400)) {
      return { ok: true, finalUrl: response.url || url };
    }
    if (response.status === 405 || response.status === 403) {
      const getResponse = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller,
        headers,
      });
      if (getResponse.ok || (getResponse.status >= 300 && getResponse.status < 400)) {
        return { ok: true, finalUrl: getResponse.url || url };
      }
    }
  } catch (err) {
    debugLog("reachability_error", { url, error: err instanceof Error ? err.message : err });
  }
  return { ok: false };
}

async function collectDeterministicResultsForAgent(agent: any) {
  const rawRecord: any = await DOIRawRecord.findOne({
    promotedAgentId: agent._id,
  })
    .sort({ updatedAt: -1 })
    .lean();

  const candidateSources = buildCandidateUrls(agent, rawRecord);
  debugLog("candidate_sources", {
    agentId: agent._id?.toString(),
    agencyName: agent.agencyName,
    totalCandidates: candidateSources.length,
  });

  if (!candidateSources.length) {
    await DOIAgent.updateOne(
      { _id: agent._id },
      {
        $set: {
          searchQueries: [],
          lastSearchAt: new Date(),
          pipelineStage: "discovery",
          stuckReason: "no_candidates",
        },
        $inc: { attempts: 1 },
      }
    );
    return { candidates: 0, reachable: 0, saved: 0 };
  }

  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        searchQueries: candidateSources.map((c) => c.url),
        lastSearchAt: new Date(),
        pipelineStage: "discovery",
        stuckReason: "",
      },
      $inc: { attempts: 1 },
    }
  );

  let saved = 0;
  let reachable = 0;
  let tested = 0;

  for (const candidate of candidateSources) {
    tested += 1;
    const normalizedCandidate = normalizeDomain(candidate.url);
    if (!normalizedCandidate.domain) {
      debugLog("candidate_rejected_normalization", {
        url: candidate.url,
        reason: normalizedCandidate.rejectedReason,
      });
      continue;
    }

    const reachability = await isReachable(normalizedCandidate.website || candidate.url);
    if (!reachability.ok) {
      debugLog("candidate_unreachable", { url: candidate.url });
      continue;
    }

    reachable += 1;
    const finalNormalized = normalizeDomain(reachability.finalUrl || candidate.url);
    if (!finalNormalized.domain) continue;

    const title =
      agent.agencyName ||
      `${agent.firstName || ""} ${agent.lastName || ""}`.trim() ||
      finalNormalized.domain ||
      candidate.reason;
    const snippet = `deterministic:${candidate.reason}`;
    const signals = computeDiscoverySignals(agent, {
      title,
      snippet,
      url: finalNormalized.website || reachability.finalUrl || candidate.url,
      domain: finalNormalized.domain,
    });
    console.log(
      `[discovery:candidate] agent=${agent._id} url=${finalNormalized.website || reachability.finalUrl || candidate.url} score=${
        signals.score
      } matched_name=${signals.matchedName ? 1 : 0} matched_agency=${signals.matchedAgency ? 1 : 0} matched_location=${
        signals.matchedLocation ? 1 : 0
      }`
    );
    if (signals.score < 35) {
      console.log(
        `[discovery-reject] agent=${agent._id} url=${finalNormalized.website || reachability.finalUrl || candidate.url} reason=low_score score=${signals.score}`
      );
      continue;
    }
    const snippetEmails = extractEmailsFromText(`${title} ${snippet} ${finalNormalized.website || ""}`);

    const upsert = await DOIAgentDiscovery.updateOne(
      { agentId: agent._id, sourceUrl: finalNormalized.website || reachability.finalUrl || candidate.url },
      {
        $setOnInsert: {
          candidateAgencyName: agent.agencyName || rawRecord?.candidateAgencyName || "",
          fetchAttempts: 0,
          parseAttempts: 0,
        },
        $set: {
          sourceUrl: reachability.finalUrl || candidate.url,
          sourceType: `deterministic:${candidate.reason}`,
          rootDomain: finalNormalized.domain,
          url: finalNormalized.website || reachability.finalUrl || candidate.url,
          sourceQuery: candidate.reason,
          title,
          snippet,
          position: tested,
          fetched: false,
          parsed: false,
          lastFetchedAt: null,
          lastParsedAt: null,
          matchedName: signals.matchedName,
          matchedAgency: signals.matchedAgency,
          matchedLocation: signals.matchedLocation,
          matchedState: signals.matchedState,
          matchedInsuranceTerms: signals.matchedKeywords,
          finalScore: signals.score,
          discoveryScore: signals.score,
          foundEmails: snippetEmails.all,
          personalEmails: snippetEmails.personal,
          workEmails: snippetEmails.work,
        },
      },
      { upsert: true }
    );
    if (upsert.upsertedCount) saved += 1;
    console.log(
      `[discovery:selected] agent=${agent._id} url=${finalNormalized.website || reachability.finalUrl || candidate.url} score=${signals.score}`
    );
  }

  const totalResults = await DOIAgentDiscovery.countDocuments({
    agentId: agent._id,
  });
  const pipelineStage = totalResults > 0 ? "domain" : ("discovery" as const);
  const stuckReason = totalResults > 0 ? "" : "deterministic_no_domain";

  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        lastSearchAt: new Date(),
        searchResultCount: totalResults,
        pipelineStage,
        stuckReason,
      },
    }
  );

  return { candidates: tested, reachable, saved };
}

async function searchDeterministicAgents(limit: number) {
  if (limit <= 0) return { processed: 0, saved: 0, empty: 0, reachable: 0, candidates: 0 };
  const staleBoundary = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const agents = await DOIAgent.find({
    agencyDomain: "",
    enrichmentStatus: { $ne: "failed" },
    pipelineStage: { $in: ["pending", "discovery"] },
    $or: [
      { searchResultCount: { $lt: 5 } },
      { lastSearchAt: { $lt: staleBoundary } },
      { lastSearchAt: { $exists: false } },
    ],
  })
    .sort({ lastSearchAt: 1 })
    .limit(limit)
    .lean();

  let processed = 0;
  let saved = 0;
  let empty = 0;
  let reachable = 0;
  let candidates = 0;

  for (const agent of agents) {
    const result = await collectDeterministicResultsForAgent(agent);
    processed += 1;
    saved += result.saved;
    reachable += result.reachable;
    candidates += result.candidates;
    if (!result.saved && !result.reachable) empty += 1;
  }

  return { processed, saved, empty, reachable, candidates };
}

async function countGoodDiscoveries(agentId: any) {
  return DOIAgentDiscovery.countDocuments({
    agentId,
    $or: [
      { matchedName: true },
      { personalEmails: { $exists: true, $ne: [] } },
      { workEmails: { $exists: true, $ne: [] } },
      { discoveryScore: { $gte: 40 } },
      { sourceType: /^fallback/i },
    ],
  });
}

async function searchFallbackAgents(limit: number) {
  if (limit <= 0) return { processed: 0, inserted: 0, errors: 0 };
  const agents = await DOIAgent.find({
    pipelineStage: "email",
    emailDiscoveryMode: "personal_fallback",
    enrichmentStatus: { $ne: "failed" },
  })
    .sort({ lastSearchAt: 1 })
    .limit(limit * 3)
    .lean();

  let processed = 0;
  let inserted = 0;
  let errors = 0;

  for (const agent of agents) {
    if (processed >= limit) break;
    const good = await countGoodDiscoveries(agent._id);
    console.log(`[fallback-eligible] agent=${agent._id} good_discovery_count=${good}`);
    if (good > 0) {
      console.log(`[fallback-skip] agent=${agent._id} reason=good_discovery_exists count=${good}`);
      continue;
    }
    try {
      const result = await collectFallbackResultsForAgent(agent);
      processed += 1;
      inserted += result.saved;
    } catch (err) {
      errors += 1;
      console.warn("[fallback-search:error]", {
        agentId: agent._id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { processed, inserted, errors };
}

export async function searchAgentsBatch(limit = DOI_CONFIG.searchBatchSize) {
  const fallbackSummary = await searchFallbackAgents(limit);
  const remaining = Math.max(limit - fallbackSummary.processed, 0);
  const deterministicSummary = await searchDeterministicAgents(remaining);

  return {
    processed: fallbackSummary.processed + deterministicSummary.processed,
    inserted: fallbackSummary.inserted,
    saved: deterministicSummary.saved,
    empty: deterministicSummary.empty,
    reachable: deterministicSummary.reachable,
    candidates: deterministicSummary.candidates,
    errors: fallbackSummary.errors,
  };
}

export { collectDeterministicResultsForAgent as collectSearchResultsForAgent };

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await searchAgentsBatch();
    console.log(
      `[search-agent-web] processed=${summary.processed} candidates=${summary.candidates} reachable=${summary.reachable} inserted=${summary.saved} empty=${summary.empty}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[search-agent-web] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

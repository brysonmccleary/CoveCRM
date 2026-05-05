// scripts/discover-agent-web-presence.ts
// Crawls public web pages to collect evidence-backed agency/domain candidates.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import { DOI_CONFIG } from "./doi-config";
import { normalizeDomain } from "./normalize-domain";

const USER_AGENT =
  "Mozilla/5.0 (compatible; CoveCRM-DOI/1.0; +https://www.covecrm.com/doibot)";
const DISCOVERY_KEYWORDS = ["insurance", "broker", "agency", "licensed", "life", "annuities"];
const STATE_NAMES: Record<string, string> = {
  AL: "alabama",
  AK: "alaska",
  AZ: "arizona",
  AR: "arkansas",
  CA: "california",
  CO: "colorado",
  CT: "connecticut",
  DE: "delaware",
  FL: "florida",
  GA: "georgia",
  HI: "hawaii",
  ID: "idaho",
  IL: "illinois",
  IN: "indiana",
  IA: "iowa",
  KS: "kansas",
  KY: "kentucky",
  LA: "louisiana",
  ME: "maine",
  MD: "maryland",
  MA: "massachusetts",
  MI: "michigan",
  MN: "minnesota",
  MS: "mississippi",
  MO: "missouri",
  MT: "montana",
  NE: "nebraska",
  NV: "nevada",
  NH: "new hampshire",
  NJ: "new jersey",
  NM: "new mexico",
  NY: "new york",
  NC: "north carolina",
  ND: "north dakota",
  OH: "ohio",
  OK: "oklahoma",
  OR: "oregon",
  PA: "pennsylvania",
  RI: "rhode island",
  SC: "south carolina",
  SD: "south dakota",
  TN: "tennessee",
  TX: "texas",
  UT: "utah",
  VT: "vermont",
  VA: "virginia",
  WA: "washington",
  WV: "west virginia",
  WI: "wisconsin",
  WY: "wyoming",
};

type DiscoverySummary = {
  processed: number;
  candidates: number;
  skipped: number;
  failed: number;
};

const SEARCH_ENDPOINT = "https://duckduckgo.com/html/";

function toQuery(agent: any): string {
  const base = `${agent.firstName || ""} ${agent.lastName || ""}`.trim();
  const parts = [base, agent.state, "insurance agent"].filter(Boolean);
  return encodeURIComponent(parts.join(" "));
}

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: controller.signal,
    });
    if (!resp.ok) return "";
    const text = await resp.text();
    return text;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function stripHtml(html: string): string {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinksFromSearch(html: string): string[] {
  const matches = html.match(/<a[^>]+class="result__a"[^>]*href="([^"]+)"/gi) || [];
  const links: string[] = [];
  for (const match of matches) {
    const hrefMatch = match.match(/href="([^"]+)"/i);
    if (!hrefMatch) continue;
    const url = hrefMatch[1];
    if (url.startsWith("http")) {
      links.push(url);
    }
    if (links.length >= 6) break;
  }
  return links;
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : "";
}

function buildSnippet(text: string, keyword: string): string {
  const idx = text.toLowerCase().indexOf(keyword.toLowerCase());
  if (idx === -1) return text.slice(0, 200);
  const start = Math.max(idx - 80, 0);
  return text.slice(start, start + 200);
}

function evaluateEvidence(agent: any, text: string, domain: string) {
  const lower = text.toLowerCase();
  const fullName = `${(agent.firstName || "").trim()} ${(agent.lastName || "").trim()}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const matchedName = fullName ? lower.includes(fullName) : false;
  const stateWord = STATE_NAMES[String(agent.state || "").toUpperCase()];
  const matchedState =
    !!stateWord && (lower.includes(stateWord) || lower.includes(String(agent.state || "").toLowerCase()));
  const matchedInsuranceTerms = DISCOVERY_KEYWORDS.some((kw) => lower.includes(kw));
  let score = 0;
  if (matchedName) score += 45;
  else if (agent.lastName && lower.includes(String(agent.lastName).toLowerCase())) score += 15;
  if (matchedState) score += 15;
  if (matchedInsuranceTerms) score += 10;
  if (domain.includes(String(agent.lastName || "").toLowerCase())) score += 10;
  return { matchedName, matchedState, matchedInsuranceTerms, evidenceScore: score };
}

async function upsertDiscoveryCandidate(params: {
  agent: any;
  url: string;
  html: string;
  sourceType: string;
}): Promise<boolean> {
  const { agent, url, html, sourceType } = params;
  const normalized = normalizeDomain(url);
  if (!normalized.domain) return false;
  const text = stripHtml(html);
  if (!text) return false;

  const evidence = evaluateEvidence(agent, text, normalized.domain);
  const snippet = buildSnippet(text, agent.lastName || agent.firstName || "");
  const candidateAgencyName = extractTitle(html) || (agent.agencyName || "");

  await DOIAgentDiscovery.updateOne(
    {
      agentId: agent._id,
      candidateDomain: normalized.domain,
      sourceUrl: url,
    },
    {
      $set: {
        candidateAgencyName,
        candidateWebsite: normalized.website,
        sourceType,
        evidenceText: snippet,
        evidenceScore: evidence.evidenceScore,
        matchedName: evidence.matchedName,
        matchedState: evidence.matchedState,
        matchedInsuranceTerms: evidence.matchedInsuranceTerms,
        checkedAt: new Date(),
      },
    },
    { upsert: true }
  );

  return true;
}

export async function discoverWebPresenceForAgent(
  agent: any
): Promise<{ created: number; error?: string }> {
  if (!agent.firstName || !agent.lastName) {
    return { created: 0, error: "missing_name" };
  }
  const recentCandidate = await DOIAgentDiscovery.findOne({
    agentId: agent._id,
    createdAt: { $gt: new Date(Date.now() - 1000 * 60 * 60 * 12) },
  })
    .select("_id")
    .lean();
  if (recentCandidate) {
    return { created: 0, error: "recently_processed" };
  }

  const query = toQuery(agent);
  const searchHtml = await fetchWithTimeout(`${SEARCH_ENDPOINT}?q=${query}`);
  if (!searchHtml) {
    return { created: 0, error: "search_failed" };
  }

  const links = extractLinksFromSearch(searchHtml);
  let created = 0;
  for (const link of links) {
    const html = await fetchWithTimeout(link);
    if (!html) continue;
    const inserted = await upsertDiscoveryCandidate({
      agent,
      url: link,
      html,
      sourceType: "duckduckgo",
    });
    if (inserted) created += 1;
  }

  if (created > 0) {
    await DOIAgentEnrichment.updateOne(
      { agentId: agent._id },
      {
        $setOnInsert: { stage: "pending" },
        $set: { lastAttemptAt: new Date(), notes: "Discovery candidates captured" },
      },
      { upsert: true }
    );
  }

  return { created };
}

export async function discoverAgentWebPresence(limit = DOI_CONFIG.discoveryBatchSize) {
  const agents = await DOIAgent.find({ enrichmentStatus: "pending" })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const summary: DiscoverySummary = {
    processed: agents.length,
    candidates: 0,
    skipped: 0,
    failed: 0,
  };

  for (const agent of agents) {
    try {
      const result = await discoverWebPresenceForAgent(agent);
      summary.candidates += result.created;
      if (result.error === "recently_processed") summary.skipped += 1;
      else if (result.error && !result.created) summary.failed += 1;
    } catch (err) {
      summary.failed += 1;
      console.warn("[discover-agent-web] failed", {
        agentId: agent._id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await discoverAgentWebPresence();
    console.log(
      `[discover-agent-web] processed=${summary.processed} candidates=${summary.candidates} skipped=${summary.skipped} failed=${summary.failed}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[discover-agent-web] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

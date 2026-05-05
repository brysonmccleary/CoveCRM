// scripts/parse-agent-pages.ts
// Fetches and parses stored search results for DOI agents.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import { DOI_CONFIG } from "./doi-config";
import { fetchAndParsePage } from "../lib/doi/pageParser";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "protonmail.com",
  "live.com",
  "msn.com",
]);
const GENERIC_JUNK_DOMAINS = new Set([
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
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

type ParseSummary = {
  processed: number;
  parsed: number;
  failed: number;
};

async function parseDocs(docs: any[]): Promise<ParseSummary> {
  const summary: ParseSummary = { processed: 0, parsed: 0, failed: 0 };
  const perAgentEmailStats = new Map<
    string,
    { total: number; work: number; personal: number }
  >();
  for (const doc of docs) {
    summary.processed += 1;
    try {
      if (GENERIC_JUNK_DOMAINS.has((doc.rootDomain || "").toLowerCase()) && !doc.matchedName) {
        console.log(
          `[parse-skip-junk] agent=${doc.agentId} url=${doc.url} reason=generic_domain_no_name`
        );
        await DOIAgentDiscovery.updateOne({ _id: doc._id }, { $set: { rejectedReason: "generic_domain_no_name" } });
        continue;
      }
      console.log(
        `[discovery-selected] agent=${doc.agentId} url=${doc.url} score=${doc.discoveryScore ?? doc.finalScore ?? 0}`
      );
      await DOIAgentDiscovery.updateOne(
        { _id: doc._id },
        { $inc: { fetchAttempts: 1 } }
      );
      const parsed = await fetchAndParsePage(doc.url);
      const extractedFromText = extractEmailsFromText(parsed.pageText || "");
      const combinedFound = dedupeEmails([
        ...(parsed.foundEmails || []),
        ...extractedFromText.all,
      ]);
      const combinedPersonal = dedupeEmails([
        ...(parsed.personalEmails || []),
        ...extractedFromText.personal,
        ...combinedFound.filter((email) => {
          const domain = email.split("@")[1] || "";
          return PERSONAL_EMAIL_DOMAINS.has(domain);
        }),
      ]);
      const combinedWork = combinedFound.filter((email) => {
        const domain = email.split("@")[1] || "";
        return domain && !PERSONAL_EMAIL_DOMAINS.has(domain);
      });

      const hasPageText = Boolean(parsed.pageText);
      await DOIAgentDiscovery.updateOne(
        { _id: doc._id },
        {
          $set: {
            fetched: true,
            parsed: true,
            parseFailedReason: "",
            lastFetchedAt: new Date(),
            lastParsedAt: new Date(),
            pageTitle: parsed.pageTitle,
            foundEmails: combinedFound,
            personalEmails: combinedPersonal,
            workEmails: combinedWork,
            foundPhones: parsed.foundPhones,
            foundNames: parsed.foundNames,
            foundAgencyNames: parsed.foundAgencyNames,
            insuranceTermsFound: parsed.insuranceTermsFound,
            locationHints: parsed.locationHints,
            isTeamPage: parsed.isTeamPage,
            isContactPage: parsed.isContactPage,
            isAboutPage: parsed.isAboutPage,
            pageText: truncateText(parsed.pageText || ""),
          },
          $inc: { parseAttempts: 1 },
        }
      );
      console.log(
        `[doi-parse:update] discovery=${doc._id} saved_found=${combinedFound.length} saved_personal=${combinedPersonal.length} saved_work=${combinedWork.length} has_page_text=${
          hasPageText ? "yes" : "no"
        }`
      );
      const extracted = buildEmailRecords(combinedFound, combinedPersonal, doc.url);
      console.log(
        `[email-extract] agent=${doc.agentId} discovery=${doc._id} url=${doc.url} total=${extracted.records.length} work=${extracted.work} personal=${extracted.personal}`
      );
      if (extracted.records.length) {
        await DOIAgentEnrichment.updateOne(
          { agentId: doc.agentId },
          {
            $setOnInsert: { agentId: doc.agentId },
            $addToSet: {
              discoveredEmails: { $each: extracted.records },
            },
          },
          { upsert: true }
        );
        const key = String(doc.agentId);
        const stats = perAgentEmailStats.get(key) || { total: 0, work: 0, personal: 0 };
        stats.total += extracted.records.length;
        stats.work += extracted.work;
        stats.personal += extracted.personal;
        perAgentEmailStats.set(key, stats);
      }
      await DOIAgent.updateOne(
        { _id: doc.agentId },
        { $set: { lastParsedAt: new Date() } }
      );
      summary.parsed += 1;
    } catch (err: any) {
      summary.failed += 1;
      await DOIAgentDiscovery.updateOne(
        { _id: doc._id },
        {
          $set: {
            fetchFailedReason: err?.message || "parse_failed",
            parsed: false,
            lastParsedAt: new Date(),
          },
          $inc: { parseAttempts: 1 },
        }
      );
      console.error("[parse-agent-pages] failed", doc.url, err?.message || err);
    }
  }
  perAgentEmailStats.forEach((stats, agentId) => {
    console.log(
      `[email-extract] agent=${agentId} found=${stats.total} work=${stats.work} personal=${stats.personal}`
    );
  });
  return summary;
}

function buildEmailRecords(emails: string[], personalEmails: string[], sourceUrl: string) {
  const map = new Map<
    string,
    { emailType: "work" | "personal"; source: string; sourceUrl: string }
  >();
  const addEmail = (email: string, forcedType?: "work" | "personal") => {
    const normalized = (email || "").trim().toLowerCase();
    if (!normalized.includes("@")) return;
    if (map.has(normalized)) return;
    const domain = normalized.split("@")[1];
    let type: "work" | "personal" =
      forcedType || (domain && PERSONAL_EMAIL_DOMAINS.has(domain) ? "personal" : "work");
    map.set(normalized, {
      emailType: type,
      source: "discovery_page",
      sourceUrl,
    });
  };
  (emails || []).forEach((email: string) => addEmail(email));
  (personalEmails || []).forEach((email: string) => addEmail(email, "personal"));
  const records = Array.from(map.entries()).map(([email, meta]) => ({
    email,
    emailType: meta.emailType,
    source: meta.source,
    sourceUrl: meta.sourceUrl,
    createdAt: new Date(),
  }));
  const work = records.filter((entry) => entry.emailType === "work").length;
  const personal = records.length - work;
  return { records, work, personal };
}

function extractEmailsFromText(text: string) {
  if (!text) return { all: [] as string[], personal: [] as string[] };
  const matches = text.match(EMAIL_REGEX) || [];
  const normalizedAll = dedupeEmails(matches);
  const personal = normalizedAll.filter((email) => {
    const domain = email.split("@")[1] || "";
    return PERSONAL_EMAIL_DOMAINS.has(domain);
  });
  return { all: normalizedAll, personal };
}

function dedupeEmails(emails: string[]) {
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
}

function truncateText(text: string, max = 25000) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max);
}

export async function parsePagesForAgent(agentId: any, limit = 3) {
  const docs = await DOIAgentDiscovery.find({
    agentId,
    url: { $ne: "" },
    rootDomain: { $ne: "" },
    $and: [
      { $or: [{ parsed: false }, { parsed: { $exists: false } }] },
      { $or: [{ fetchAttempts: { $lt: 4 } }, { fetchAttempts: { $exists: false } }] },
    ],
  })
    .sort({ position: 1 })
    .limit(limit)
    .lean();
  if (!docs.length) return { processed: 0, parsed: 0, failed: 0 };
  return parseDocs(docs);
}

export async function parseAgentPages(limit = DOI_CONFIG.parseBatchSize) {
  const fallbackDocs = await selectFallbackDocs(limit);
  if (fallbackDocs.length) {
    fallbackDocs.forEach((doc) =>
      console.log(
        `[doi-parse:target] agent=${doc.agentId} discovery=${doc._id} reason=missing_email_fields`
      )
    );
    return parseDocs(fallbackDocs);
  }

  const docs = await DOIAgentDiscovery.find({
    url: { $ne: "" },
    rootDomain: { $ne: "" },
    $and: [
      { $or: [{ parsed: false }, { parsed: { $exists: false } }] },
      { $or: [{ fetchAttempts: { $lt: 4 } }, { fetchAttempts: { $exists: false } }] },
    ],
  })
    .sort({ discoveryScore: -1, finalScore: -1, updatedAt: 1 })
    .limit(limit)
    .lean();

  return parseDocs(docs);
}

async function selectFallbackDocs(limit: number) {
  const fallbackAgents = await DOIAgent.find({
    pipelineStage: "email",
    emailDiscoveryMode: "personal_fallback",
  })
    .select("_id")
    .limit(500)
    .lean();

  if (!fallbackAgents.length) return [];
  const agentIds = fallbackAgents.map((agent) => agent._id);
  const missingFilter = buildMissingDiscoveryFilter();

  const docs = await DOIAgentDiscovery.find({
    agentId: { $in: agentIds },
    url: { $ne: "" },
    rootDomain: { $ne: "" },
    ...missingFilter,
    sourceType: /fallback/i,
    $or: [{ isGenericJunk: { $ne: true } }, { matchedName: true }],
  })
    .sort({ discoveryScore: -1, finalScore: -1, updatedAt: 1 })
    .limit(limit)
    .lean();

  return docs;
}

function buildMissingDiscoveryFilter() {
  const emptyArrayExpr = (field: string) => ({
    $expr: { $eq: [{ $size: { $ifNull: [`$${field}`, []] } }, 0] },
  });

  return {
    $or: [
      emptyArrayExpr("foundEmails"),
      emptyArrayExpr("personalEmails"),
      emptyArrayExpr("workEmails"),
      { pageText: { $exists: false } },
      { pageText: { $in: [null, ""] } },
    ],
  };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await parseAgentPages();
    console.log(
      `[parse-agent-pages] processed=${summary.processed} parsed=${summary.parsed} failed=${summary.failed}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[parse-agent-pages] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

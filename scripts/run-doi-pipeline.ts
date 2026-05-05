// scripts/run-doi-pipeline.ts
// Master DOI enrichment orchestrator that runs discovery -> scoring -> patterns -> verification -> promotion.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import EmailVerification from "../models/EmailVerification";
import { DOI_CONFIG } from "./doi-config";
import { scrapeAllStates } from "./scrape-doi";
import { runNormalizeDOIRaw } from "./normalize-doi-raw";
import { runPromoteDOIRaw } from "./promote-doi-raw-to-agent";
import { generateEmailPatternsForAgent } from "./generate-email-patterns";
import { verifyEmail } from "./verify-email-smtp";
import { promoteAgentById } from "./promote-verified-to-doilead";
import { collectSearchResultsForAgent } from "./search-agent-web";
import { parsePagesForAgent } from "./parse-agent-pages";
import { resolveIdentityForAgent } from "./resolve-agent-identity";

type PipelineSummary = {
  processed: number;
  searches: number;
  searchResultsSaved: number;
  pagesParsed: number;
  identityEvaluated: number;
  domainsSelected: number;
  patternsGenerated: number;
  emailsVerified: number;
  emailsVerifiedValid: number;
  emailsVerifiedInvalid: number;
  promoted: number;
  skipped: number;
  failed: number;
  rejectionBuckets: Record<string, number>;
  example?: any;
};

const PENDING_VERIFICATION_STATUSES = ["pending", "temp_failure", "timeout"];

function incrementBucket(summary: PipelineSummary, bucket?: string) {
  if (!bucket) return;
  summary.rejectionBuckets[bucket] = (summary.rejectionBuckets[bucket] || 0) + 1;
}

async function touchAgent(agentId: string, stage: string) {
  await DOIAgent.updateOne(
    { _id: agentId },
    {
      $set: { pipelineStage: stage, lastAttemptAt: new Date(), lastCheckedAt: new Date() },
      $inc: { attempts: 1 },
    }
  );
}

async function markAgentFailed(agentId: string, reason: string) {
  await DOIAgent.updateOne(
    { _id: agentId },
    {
      $set: {
        enrichmentStatus: "failed",
        pipelineStage: "failed",
        stuckReason: reason,
        lastRejectionReason: reason,
      },
      $addToSet: { rejectionReasons: reason },
    }
  );
  await DOIAgentEnrichment.updateOne(
    { agentId },
    { $set: { stage: "failed", notes: reason } },
    { upsert: true }
  );
}

async function requeueAgent(agentId: string, reason: string) {
  await DOIAgent.updateOne(
    { _id: agentId },
    {
      $set: {
        pipelineStage: "pending",
        stuckReason: reason,
        lastRejectionReason: reason,
      },
      $addToSet: { rejectionReasons: reason },
    }
  );
  await DOIAgentEnrichment.updateOne(
    { agentId },
    { $set: { stage: "pending", notes: `Requeued (${reason})` } },
    { upsert: true }
  );
}

function hoursSince(value?: Date) {
  if (!value) return Infinity;
  return (Date.now() - value.getTime()) / 36e5;
}

async function handleStuck(agent: any, summary: PipelineSummary) {
  const stage = agent.pipelineStage || "pending";
  if (stage === "verification") {
    const catchAllLoop = await EmailVerification.countDocuments({
      agentId: agent._id,
      reasonBucket: "catch_all",
      attempts: { $gte: DOI_CONFIG.verifyMaxAttempts },
    });
    if (catchAllLoop) {
      await markAgentFailed(String(agent._id), "catch_all");
      summary.failed += 1;
      incrementBucket(summary, "catch_all");
      return true;
    }
  }

  const thresholds = DOI_CONFIG.stuckThresholdHours as Record<string, number>;
  const threshold = thresholds[stage] || 0;
  const reference = agent.lastAttemptAt || agent.updatedAt || agent.createdAt;
  const ageHours = hoursSince(reference);
  if (!threshold || ageHours < threshold) return false;

  const reason = `stuck_${stage}`;
  if ((agent.attempts || 0) >= DOI_CONFIG.pipelineMaxAttempts) {
    await markAgentFailed(String(agent._id), reason);
    summary.failed += 1;
  } else {
    await requeueAgent(String(agent._id), reason);
    summary.skipped += 1;
  }
  incrementBucket(summary, reason);
  return true;
}

const SEARCH_STALE_MINUTES = 12 * 60;

async function ensureSearchResults(agent: any, summary: PipelineSummary) {
  if (agent.agencyDomain) return false;
  const lastSearchAt = agent.lastSearchAt ? new Date(agent.lastSearchAt).getTime() : 0;
  const staleBoundary = Date.now() - SEARCH_STALE_MINUTES * 60 * 1000;
  const needsSearch =
    !agent.searchResultCount || agent.searchResultCount < 5 || !lastSearchAt || lastSearchAt < staleBoundary;
  if (!needsSearch) return false;

  await touchAgent(String(agent._id), "search");
  const result = await collectSearchResultsForAgent(agent);
  summary.searches += 1;
  summary.searchResultsSaved += result.saved || 0;
  if (!result.saved) incrementBucket(summary, "search_empty");
  return true;
}

async function ensureParsedPages(agent: any, summary: PipelineSummary) {
  if (agent.agencyDomain) return false;
  const pending = await DOIAgentDiscovery.countDocuments({ agentId: agent._id, parsed: false, rootDomain: { $ne: "" } });
  if (!pending) return false;
  await touchAgent(String(agent._id), "parse");
  const result = await parsePagesForAgent(agent._id, 3);
  summary.pagesParsed += result.parsed || 0;
  if (!result.parsed) incrementBucket(summary, "parse_failed");
  return true;
}

async function ensureIdentity(agent: any, summary: PipelineSummary) {
  if (agent.agencyDomain) return false;
  const parsedDocs = await DOIAgentDiscovery.countDocuments({ agentId: agent._id, parsed: true });
  if (!parsedDocs) return false;
  await touchAgent(String(agent._id), "identity");
  const result = await resolveIdentityForAgent(agent);
  summary.identityEvaluated += result.processed || 0;
  if (result.selected) {
    summary.domainsSelected += 1;
    return true;
  }
  if (result.flagged && result.reason) incrementBucket(summary, result.reason);
  return false;
}

async function ensurePatterns(agent: any, summary: PipelineSummary) {
  if (!agent.agencyDomain) return false;
  const existing = await EmailVerification.countDocuments({ agentId: agent._id });
  if (existing > 0) return false;
  await touchAgent(String(agent._id), "patterns");
  const result = await generateEmailPatternsForAgent({
    _id: agent._id,
    firstName: agent.firstName,
    lastName: agent.lastName,
    agencyDomain: agent.agencyDomain,
    domainTrustLevel: agent.domainTrustLevel,
  });
  if (result.inserted > 0) {
    summary.patternsGenerated += result.inserted;
    return true;
  }
  incrementBucket(summary, "patterns_skipped");
  return false;
}

async function ensureVerification(agent: any, summary: PipelineSummary) {
  const cooldownBoundary = new Date(Date.now() - DOI_CONFIG.verifyAttemptCooldownMinutes * 60 * 1000);
  const record = await EmailVerification.findOne({
    agentId: agent._id,
    verificationStatus: { $in: PENDING_VERIFICATION_STATUSES },
    $or: [
      { attempts: { $lt: DOI_CONFIG.verifyMaxAttempts } },
      { lastAttemptAt: { $lt: cooldownBoundary } },
      { lastAttemptAt: { $exists: false } },
    ],
  })
    .sort({ createdAt: 1 })
    .lean();
  if (!record) return false;

  await touchAgent(String(agent._id), "verification");
  const status = await verifyEmail(record);
  summary.emailsVerified += 1;
  if (status === "valid") summary.emailsVerifiedValid += 1;
  else summary.emailsVerifiedInvalid += 1;
  incrementBucket(summary, status !== "valid" ? status : undefined);
  return true;
}

async function attemptPromotion(agent: any, summary: PipelineSummary) {
  await touchAgent(String(agent._id), "promotion");
  const result = await promoteAgentById(String(agent._id));
  if (result.ok) {
    summary.promoted += 1;
    return { handled: true };
  }
  incrementBucket(summary, result.reason || "promotion_skipped");
  return { handled: false };
}

async function processAgent(agent: any, summary: PipelineSummary) {
  await DOIAgent.updateOne({ _id: agent._id }, { $set: { lastCheckedAt: new Date() } });
  if (await handleStuck(agent, summary)) return;

  let currentAgent = await DOIAgent.findById(agent._id).lean();
  if (!currentAgent) return;

  if (!currentAgent.agencyDomain) {
    if (await ensureSearchResults(currentAgent, summary)) return;
    if (await ensureParsedPages(currentAgent, summary)) return;
    if (await ensureIdentity(currentAgent, summary)) return;
    summary.skipped += 1;
    return;
  }

  currentAgent = await DOIAgent.findById(agent._id).lean();
  if (!currentAgent) return;

  const patternsMade = await ensurePatterns(currentAgent, summary);
  if (patternsMade) return;

  const verified = await ensureVerification(currentAgent, summary);
  if (verified) return;

  const promotionResult = await attemptPromotion(currentAgent, summary);
  if (promotionResult.handled) return;

  summary.skipped += 1;
}

export async function runDoiPipeline(batchSize = DOI_CONFIG.pipelineBatchSize): Promise<PipelineSummary> {
  const cooldownBoundary = new Date(Date.now() - DOI_CONFIG.pipelineCooldownMinutes * 60 * 1000);
  const agents = await DOIAgent.find({
    enrichmentStatus: { $ne: "enriched" },
    attempts: { $lt: DOI_CONFIG.pipelineMaxAttempts * 2 },
    $or: [{ lastCheckedAt: { $lt: cooldownBoundary } }, { lastCheckedAt: { $exists: false } }],
  })
    .sort({ lastCheckedAt: 1 })
    .limit(batchSize)
    .lean();

  const summary: PipelineSummary = {
    processed: agents.length,
    searches: 0,
    searchResultsSaved: 0,
    pagesParsed: 0,
    identityEvaluated: 0,
    domainsSelected: 0,
    patternsGenerated: 0,
    emailsVerified: 0,
    emailsVerifiedValid: 0,
    emailsVerifiedInvalid: 0,
    promoted: 0,
    skipped: 0,
    failed: 0,
    rejectionBuckets: {},
  };

  for (const agent of agents) {
    try {
      await processAgent(agent, summary);
    } catch (err) {
      summary.failed += 1;
      incrementBucket(summary, "pipeline_error");
      console.error("[run-doi-pipeline] agent failed", agent._id, err);
    }
  }

  if (agents[0]) {
    summary.example = await buildPipelineExample(agents[0]._id);
  }

  return summary;
}

async function buildPipelineExample(agentId: any) {
  const agent = await DOIAgent.findById(agentId).lean();
  if (!agent) return null;
  const discoveries = await DOIAgentDiscovery.find({ agentId })
    .sort({ position: 1, updatedAt: -1 })
    .limit(5)
    .lean();
  const verifications = await EmailVerification.find({ agentId })
    .sort({ confidenceScore: -1 })
    .limit(3)
    .lean();
  return {
    agent: {
      id: agent._id,
      name: `${agent.firstName || ""} ${agent.lastName || ""}`.trim(),
      state: agent.state,
      city: agent.city,
      identityScore: agent.identityScore,
      identityConfidence: agent.identityConfidence,
      agencyDomain: agent.agencyDomain,
      evidenceSummary: agent.evidenceSummary,
      reviewNeeded: agent.reviewNeeded,
    },
    searchQueries: agent.searchQueries || [],
    searchResults: discoveries.map((doc) => ({
      url: doc.url,
      rootDomain: doc.rootDomain,
      title: doc.title,
      snippet: doc.snippet,
      position: doc.position,
      parsed: doc.parsed,
      identityScore: doc.identityScore,
      identityConfidence: doc.identityConfidence,
      accepted: doc.accepted,
      reasons: doc.identityReasons?.slice(0, 5) || [],
    })),
    verifications: verifications.map((verification) => ({
      email: verification.email,
      status: verification.verificationStatus,
      confidenceScore: verification.confidenceScore,
      pattern: verification.patternUsed,
      attempts: verification.attempts,
      verifiedAt: verification.verifiedAt,
    })),
  };
}

export async function runFullDoiPipeline(batchSize = DOI_CONFIG.pipelineBatchSize) {
  // Stage 1: Raw landing
  console.info("[doi-full-pipeline] Stage 1 — scraping raw records…");
  const scrapeResult = await scrapeAllStates();
  console.info(
    `[doi-full-pipeline] Scrape done — landed=${scrapeResult.totalImported} dupes=${scrapeResult.totalUpdated} errors=${scrapeResult.totalErrors}`
  );

  const iterations: Array<{
    loop: number;
    normalize: Awaited<ReturnType<typeof runNormalizeDOIRaw>>;
    promote: Awaited<ReturnType<typeof runPromoteDOIRaw>>;
    enrich: Awaited<ReturnType<typeof runDoiPipeline>>;
  }> = [];

  let loop = 1;
  while (true) {
    console.info(`[doi-full-pipeline] Loop ${loop} — normalizing batch…`);
    const normalizeResult = await runNormalizeDOIRaw(5000);

    console.info(`[doi-full-pipeline] Loop ${loop} — promoting raw batch…`);
    const promoteResult = await runPromoteDOIRaw(1000);

    console.info(`[doi-full-pipeline] Loop ${loop} — running enrichment pipeline…`);
    const enrichResult = await runDoiPipeline(batchSize);

    iterations.push({ loop, normalize: normalizeResult, promote: promoteResult, enrich: enrichResult });
    console.info(
      `[doi-full-pipeline] Loop ${loop} summary: normalizeProcessed=${normalizeResult.processed} promoteProcessed=${promoteResult.processed} agentsProcessed=${enrichResult.processed} leadsPromoted=${enrichResult.promoted}`
    );

    if (!normalizeResult.processed && !promoteResult.processed && !enrichResult.processed) {
      break;
    }

    loop += 1;
  }

  const finalIteration = iterations[iterations.length - 1] || {
    loop: 0,
    normalize: { processed: 0, normalized: 0, rejected: 0, errors: 0, rejectionBuckets: {}, samples: [] },
    promote: { processed: 0, promoted: 0, updated: 0, skipped: 0, errors: 0 },
    enrich: {
      processed: 0,
      searches: 0,
      searchResultsSaved: 0,
      pagesParsed: 0,
      identityEvaluated: 0,
      domainsSelected: 0,
      patternsGenerated: 0,
      emailsVerified: 0,
      emailsVerifiedValid: 0,
      emailsVerifiedInvalid: 0,
      promoted: 0,
      skipped: 0,
      failed: 0,
      rejectionBuckets: {},
    },
  };

  return {
    scrape: scrapeResult,
    iterations,
    final: finalIteration,
  };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const result = await runFullDoiPipeline();
    const last = result.final;
    console.log("\n══════════════════════════════════════════");
    console.log(" DOI Full Pipeline Summary");
    console.log("══════════════════════════════════════════");
    console.log(`Scrape:    landed=${result.scrape.totalImported} dupes=${result.scrape.totalUpdated} errors=${result.scrape.totalErrors}`);
    console.log(`Loops:     ${result.iterations.length}`);
    console.log(`Last Loop: normalizeProcessed=${last.normalize.processed} promoteProcessed=${last.promote.processed} agentsProcessed=${last.enrich.processed} leadsPromoted=${last.enrich.promoted}`);
    console.log("══════════════════════════════════════════\n");
    if (last.enrich.example) {
      console.log("EnrichExample:");
      console.log(JSON.stringify(last.enrich.example, null, 2));
    }
    process.exit(0);
  })().catch((err) => {
    console.error("[run-doi-pipeline] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

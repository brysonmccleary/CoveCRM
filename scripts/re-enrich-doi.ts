// scripts/re-enrich-doi.ts
// Shared re-enrichment logic for DOI agents.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import EmailVerification from "../models/EmailVerification";
import EmailBounce from "../models/EmailBounce";
import { collectSearchResultsForAgent } from "./search-agent-web";
import { parsePagesForAgent } from "./parse-agent-pages";
import { resolveIdentityForAgent } from "./resolve-agent-identity";
import { generateEmailPatternsForAgent } from "./generate-email-patterns";
import { verifyEmail, refreshBestEmailForAgent } from "./verify-email-smtp";
import { recomputeAgentQuality } from "../lib/doi/recomputeAgentQuality";

const FAILURE_STATUSES = ["invalid", "blocked", "no_mx", "error", "catch_all_suspected"];
const PENDING_STATUSES = ["pending", "temp_failure", "timeout"];
export const DEFAULT_REENRICH_BATCH = Number(process.env.DOI_REENRICH_BATCH_SIZE || 20);

export type ReEnrichSummary = {
  candidates: number;
  processed: number;
  success: number;
  failed: number;
  reasons: Record<string, number>;
};

export async function reEnrichAgentsBatch(limit = DEFAULT_REENRICH_BATCH): Promise<ReEnrichSummary> {
  await mongooseConnect();
  const summary: ReEnrichSummary = {
    candidates: 0,
    processed: 0,
    success: 0,
    failed: 0,
    reasons: {},
  };

  const candidateIds = await findCandidateAgents(limit);
  summary.candidates = candidateIds.length;

  for (const agentId of candidateIds) {
    const result = await reEnrichAgent(agentId);
    summary.processed += 1;
    if (result.ok) summary.success += 1;
    else {
      summary.failed += 1;
      const reason = result.reason || "unknown";
      summary.reasons[reason] = (summary.reasons[reason] || 0) + 1;
    }
  }

  return summary;
}

async function findCandidateAgents(limit: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const ids = new Set<string>();

  const staleAgents = await DOIAgent.find({
    enrichmentStatus: "enriched",
    $or: [{ lastEnrichedAt: { $exists: false } }, { lastEnrichedAt: { $lt: cutoff } }],
  })
    .select("_id")
    .lean();
  staleAgents.forEach((doc) => doc?._id && ids.add(String(doc._id)));

  const failedAgents = await EmailVerification.distinct("agentId", {
    verificationStatus: { $in: FAILURE_STATUSES },
  });
  failedAgents.forEach((id) => id && ids.add(String(id)));

  const enrichmentNeeds = await DOIAgentEnrichment.find({
    $or: [{ bestEmail: { $in: ["", null] } }, { bestEmailConfidence: { $lt: 60 } }],
  })
    .select("agentId")
    .lean();
  enrichmentNeeds.forEach((doc) => doc?.agentId && ids.add(String(doc.agentId)));

  const poorGrades = await DOIAgent.find({ leadGrade: { $in: ["C", "D"] } })
    .select("_id")
    .lean();
  poorGrades.forEach((doc) => doc?._id && ids.add(String(doc._id)));

  const bouncedAgents = await EmailBounce.distinct("agentId");
  bouncedAgents.forEach((id) => id && ids.add(String(id)));

  return Array.from(ids).slice(0, limit);
}

async function reEnrichAgent(agentId: string): Promise<{ ok: boolean; reason?: string }> {
  const agent = await DOIAgent.findById(agentId).lean();
  if (!agent) return { ok: false, reason: "missing_agent" };

  try {
    await collectSearchResultsForAgent(agent);
    await parsePagesForAgent(agent._id, 5);
    await resolveIdentityForAgent(agent);

    let refreshedAgent = await DOIAgent.findById(agentId).lean();
    if (!refreshedAgent) return { ok: false, reason: "missing_agent" };
    if (!refreshedAgent.agencyDomain) return { ok: false, reason: "no_domain" };

    await DOIAgentEnrichment.updateOne(
      { agentId },
      {
        $set: {
          bestEmail: "",
          bestEmailType: "",
          bestEmailConfidence: 0,
          stage: "pending",
          notes: "Re-enrichment scheduled",
        },
      },
      { upsert: true }
    );

    await EmailVerification.deleteMany({ agentId });

    await generateEmailPatternsForAgent({
      _id: refreshedAgent._id,
      firstName: refreshedAgent.firstName,
      lastName: refreshedAgent.lastName,
      agencyDomain: refreshedAgent.agencyDomain,
      domainTrustLevel: refreshedAgent.domainTrustLevel,
    });

    const pendingRecords = await EmailVerification.find({
      agentId,
      verificationStatus: { $in: PENDING_STATUSES },
    })
      .sort({ createdAt: 1 })
      .limit(50)
      .lean();

    for (const record of pendingRecords) {
      await verifyEmail(record);
    }

    refreshedAgent = await DOIAgent.findById(agentId).lean();
    if (refreshedAgent) {
      await refreshBestEmailForAgent(refreshedAgent);
    }

    const scored = await recomputeAgentQuality(agentId);
    if (!scored.ok) return scored;

    return { ok: true };
  } catch (err: any) {
    console.error("[re-enrich-doi] Agent failed", agentId, err?.message || err);
    return { ok: false, reason: err?.message || "re_enrich_failed" };
  }
}

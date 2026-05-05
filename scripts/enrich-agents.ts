// scripts/enrich-agents.ts
// Finalizes accepted discovery results and prepares agents for email verification.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import OpenAI from "openai";
import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentDiscovery from "../models/DOIAgentDiscovery";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";
import { extractWebsiteInfo } from "./find-website";
import { generateEmailPatternsForAgent } from "./generate-email-patterns";
import { DOI_CONFIG } from "./doi-config";

const openai =
  DOI_CONFIG.enableOpenAIAssist && process.env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    : null;

type EnrichmentSummary = {
  processed: number;
  prepared: number;
  skipped: number;
  missing: number;
};

async function refineAgencyName(
  agent: any,
  candidate: any
): Promise<{ agencyName: string; notes?: string }> {
  if (!openai) {
    return { agencyName: candidate.candidateAgencyName || agent.agencyName || "" };
  }
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You receive snippets of web content about an insurance agent. Extract a clean agency/firm name if available. Return JSON {\"agencyName\":\"...\"}. If unsure, return existing value.",
        },
        {
          role: "user",
          content: JSON.stringify({
            fallbackName: candidate.candidateAgencyName || agent.agencyName || "",
            snippet: candidate.evidenceText || "",
            pageTitle: candidate.candidateAgencyName || "",
          }),
        },
      ],
    });
    const parsed = JSON.parse(completion.choices?.[0]?.message?.content || "{}");
    if (typeof parsed.agencyName === "string" && parsed.agencyName.trim()) {
      return { agencyName: parsed.agencyName.trim(), notes: "OpenAI-assisted" };
    }
  } catch (err) {
    console.warn("[enrich-agents] OpenAI assist failed", err instanceof Error ? err.message : err);
  }
  return { agencyName: candidate.candidateAgencyName || agent.agencyName || "" };
}

async function enrichAgent(agent: any): Promise<"prepared" | "no_candidate" | "invalid_domain"> {
  const candidate = await DOIAgentDiscovery.findOne({ agentId: agent._id, accepted: true }).lean();
  if (!candidate) return "no_candidate";

  const info = extractWebsiteInfo(candidate.candidateWebsite || candidate.sourceUrl);
  if (!info.domain) return "invalid_domain";

  const refined = await refineAgencyName(agent, candidate);
  await DOIAgent.updateOne(
    { _id: agent._id },
    {
      $set: {
        agencyName: refined.agencyName || agent.agencyName || "",
        agencyWebsite: info.website,
        agencyDomain: info.domain,
        confidenceScore: candidate.finalScore || agent.confidenceScore || 0,
        lastCheckedAt: new Date(),
      },
    }
  );

  await DOIAgentEnrichment.updateOne(
    { agentId: agent._id },
    {
      $setOnInsert: { stage: "pending" },
      $set: {
        stage: "domain_found",
        lastAttemptAt: new Date(),
        notes: refined.notes || "Discovery accepted",
      },
    },
    { upsert: true }
  );

  await generateEmailPatternsForAgent({
    _id: agent._id,
    firstName: agent.firstName,
    lastName: agent.lastName,
    agencyDomain: info.domain,
    domainTrustLevel: agent.domainTrustLevel || "",
  });

  return "prepared";
}

export async function enrichPendingAgents(limit = DOI_CONFIG.patternBatchSize): Promise<EnrichmentSummary> {
  const agents = await DOIAgent.find({
    enrichmentStatus: "pending",
    agencyDomain: { $ne: "" },
  })
    .sort({ updatedAt: 1 })
    .limit(limit)
    .lean();

  const summary: EnrichmentSummary = {
    processed: agents.length,
    prepared: 0,
    skipped: 0,
    missing: 0,
  };

  for (const agent of agents) {
    const result = await enrichAgent(agent);
    if (result === "prepared") summary.prepared += 1;
    else if (result === "no_candidate") summary.missing += 1;
    else summary.skipped += 1;
  }

  return summary;
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const result = await enrichPendingAgents();
    console.log(
      `[enrich-agents] processed=${result.processed} prepared=${result.prepared} skipped=${result.skipped} missing=${result.missing}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[enrich-agents] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

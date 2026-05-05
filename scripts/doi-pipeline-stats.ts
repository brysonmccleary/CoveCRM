// scripts/doi-pipeline-stats.ts
// Prints a high-level summary of DOI pipeline stage counts for quick observability.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import DOIAgentEnrichment from "../models/DOIAgentEnrichment";

const STAGES = ["discovery", "domain", "patterns", "email", "ready", "failed"];

async function runPipelineStats() {
  const total = await DOIAgent.countDocuments();
  const breakdown: Record<string, number> = {};
  for (const stage of STAGES) {
    breakdown[stage] = await DOIAgent.countDocuments({ pipelineStage: stage });
  }
  const ready = breakdown["ready"] || 0;
  const failed = breakdown["failed"] || 0;
  const stuck = await DOIAgent.countDocuments({ stuckReason: { $exists: true, $ne: "" } });
  let readyWork = 0;
  let readyPersonal = 0;
  if (ready) {
    const readyAgents = await DOIAgent.find({ pipelineStage: "ready" }).select("_id").lean();
    const readyIds = readyAgents.map((doc) => doc._id);
    if (readyIds.length) {
      const enrichments = await DOIAgentEnrichment.find({ agentId: { $in: readyIds } })
        .select("bestEmailType")
        .lean();
      for (const enr of enrichments) {
        if (enr.bestEmailType === "personal") readyPersonal += 1;
        else if (enr.bestEmailType === "work" || enr.bestEmailType === "domain") readyWork += 1;
      }
    }
  }

  return { total, breakdown, ready, readyWork, readyPersonal, failed, stuck };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const stats = await runPipelineStats();
    console.log("DOI Pipeline Stats");
    console.log(`Total agents: ${stats.total}`);
    for (const stage of STAGES) {
      console.log(`  ${stage}: ${stats.breakdown[stage] || 0}`);
    }
    console.log(`Ready Total: ${stats.ready}`);
    console.log(`  Ready (work email): ${stats.readyWork || 0}`);
    console.log(`  Ready (personal email): ${stats.readyPersonal || 0}`);
    console.log(`Failed: ${stats.failed}`);
    console.log(`Stuck: ${stats.stuck}`);
    process.exit(0);
  })().catch((err) => {
    console.error("[doi-pipeline-stats] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

export { runPipelineStats };

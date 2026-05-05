import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIAgent from "../models/DOIAgent";
import { enrichFromSbsAgents } from "./enrich-from-sbs";

const DEFAULT_BATCH_SIZE = Number(process.env.DOI_IDENTITY_BATCH_SIZE || 50);

function missingIdentityFilter() {
  return {
    $and: [
      {
        $or: [
          { firstName: "" },
          { firstName: null },
          { firstName: { $exists: false } },
          { fullName: "" },
          { fullName: null },
          { fullName: { $exists: false } },
          { email: "" },
          { email: null },
          { email: { $exists: false } },
          { phone: "" },
          { phone: null },
          { phone: { $exists: false } },
        ],
      },
      {
        state: { $exists: true, $nin: ["", null] },
      },
    ],
  };
}

export async function enrichIdentityBatch(batchSize = DEFAULT_BATCH_SIZE) {
  const agents = await DOIAgent.find(missingIdentityFilter())
    .sort({ updatedAt: 1, createdAt: 1 })
    .limit(batchSize)
    .lean();

  const sbsAgents = agents.filter((agent: any) => (agent.npn || "").trim() !== "");
  const missingNpn = agents.filter((agent: any) => (agent.npn || "").trim() === "");

  for (const agent of missingNpn) {
    console.log(
      `[identity-dispatch-skip] state=${(agent.state || "").trim().toUpperCase() || "UNKNOWN"} reason=missing_npn`
    );
  }

  console.log(`[identity-dispatch] total=${agents.length}`);
  console.log(`[identity-dispatch] sbs=${sbsAgents.length}`);
  console.log(`[identity-dispatch] missing_npn=${missingNpn.length}`);

  const sbsSummary = await enrichFromSbsAgents(sbsAgents, false);

  return {
    total: agents.length,
    sbs: sbsAgents.length,
    missingNpn: missingNpn.length,
    sbsSummary,
  };
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const arg = Number(process.argv[2] || DEFAULT_BATCH_SIZE);
    const summary = await enrichIdentityBatch(
      Number.isFinite(arg) && arg > 0 ? arg : DEFAULT_BATCH_SIZE
    );
    console.log(
      `[enrich-identity] total=${summary.total} sbs=${summary.sbs} missing_npn=${summary.missingNpn} searched=${summary.sbsSummary.searched} matched=${summary.sbsSummary.matched} hydrated=${summary.sbsSummary.hydrated} errors=${summary.sbsSummary.errors}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[enrich-identity] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

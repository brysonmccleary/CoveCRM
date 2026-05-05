import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import DOIRawRecord from "../models/DOIRawRecord";
import DOIAgent from "../models/DOIAgent";
import EmailVerification from "../models/EmailVerification";
import DOILead from "../models/DOILead";

async function countDOIRaw() {
  const statuses = [
    "pending",
    "normalizing",
    "normalized",
    "promotion_pending",
    "promoted",
    "rejected",
    "failed",
  ];
  const total = await DOIRawRecord.countDocuments();
  const breakdown: Record<string, number> = {};
  for (const status of statuses) {
    breakdown[status] = await DOIRawRecord.countDocuments({ parseStatus: status });
  }
  return { total, breakdown };
}

async function countAgents() {
  const stages = [
    "pending",
    "discovery",
    "domain",
    "patterns",
    "verification",
    "promoted",
    "failed",
  ];
  const total = await DOIAgent.countDocuments();
  const breakdown: Record<string, number> = {};
  for (const stage of stages) {
    breakdown[stage] = await DOIAgent.countDocuments({ pipelineStage: stage });
  }
  const withDomain = await DOIAgent.countDocuments({ agencyDomain: { $ne: "" } });
  return { total, breakdown, withDomain };
}

async function countVerifications() {
  const total = await EmailVerification.countDocuments();
  const smtpValid = await EmailVerification.countDocuments({ smtpValid: true });
  const smtpInvalid = await EmailVerification.countDocuments({ smtpValid: false });
  const pending = await EmailVerification.countDocuments({
    verificationStatus: { $in: ["pending", "temp_failure", "timeout"] },
  });
  return { total, smtpValid, smtpInvalid, pending };
}

async function countLeads() {
  const total = await DOILead.countDocuments();
  return { total };
}

(async () => {
  await mongooseConnect();

  const [rawStats, agentStats, verificationStats, leadStats] = await Promise.all([
    countDOIRaw(),
    countAgents(),
    countVerifications(),
    countLeads(),
  ]);

  console.log("\n===== DOIRawRecord =====");
  console.log(JSON.stringify(rawStats, null, 2));
  console.log("\n===== DOIAgent =====");
  console.log(JSON.stringify(agentStats, null, 2));
  console.log("\n===== EmailVerification =====");
  console.log(JSON.stringify(verificationStats, null, 2));
  console.log("\n===== DOILead =====");
  console.log(JSON.stringify(leadStats, null, 2));

  process.exit(0);
})().catch((err) => {
  console.error("[doi-stats] Fatal:", err?.message || err);
  process.exit(1);
});

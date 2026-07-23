import { runHostedRecruitingSimulation } from "@/lib/recruiting/cloud/simulation";

const result = runHostedRecruitingSimulation();
for (const check of result.checks) {
  console.log(`${check.passed ? "PASS" : "FAIL"} · ${check.name} · ${check.detail}`);
}
console.log(`\n${result.passedCount}/${result.total} hosted recruiting lifecycle checks passed.`);
if (!result.passed) process.exitCode = 1;

import fs from "fs";
import path from "path";

// components/settings/BillingPanel.tsx has no existing render-test harness in
// this repo (no jsdom/@testing-library setup) — rather than bolt on a new
// test-infra dependency for one assertion, this verifies the exact isBasePlan
// gating expression currently in the component (so it can't silently drift
// out of sync with the real source) and replicates it as a pure predicate to
// prove a grandfathered user (hasAI: true) never sees the "Unlock AI
// Features" upgrade prompt.
describe("BillingPanel isBasePlan suppresses the AI upgrade prompt for grandfathered users", () => {
  const EXPECTED_LINE = 'effectivePlanCode === "base" && user?.hasAI !== true && !hasAIUpgrade';

  test("the component's isBasePlan expression matches what this test replicates", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "components/settings/BillingPanel.tsx"),
      "utf8",
    );
    expect(source.includes(EXPECTED_LINE)).toBe(true);
  });

  function isBasePlan(effectivePlanCode: string, hasAI: boolean | undefined, hasAIUpgrade: boolean) {
    return effectivePlanCode === "base" && hasAI !== true && !hasAIUpgrade;
  }

  test("grandfathered user (hasAI: true, planCode stays 'base') does not see the upgrade prompt", () => {
    expect(isBasePlan("base", true, false)).toBe(false);
  });

  test("ordinary base-plan user with no AI still sees the upgrade prompt", () => {
    expect(isBasePlan("base", false, false)).toBe(true);
  });

  test("a genuine ai-plan user does not see the upgrade prompt", () => {
    expect(isBasePlan("ai", true, false)).toBe(false);
  });
});

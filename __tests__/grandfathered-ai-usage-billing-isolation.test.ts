import fs from "fs";
import path from "path";

// Guards the requirement that grandfatheredAI must never leak into a usage
// exemption: it is a pure AI *feature* entitlement flag, and must never be
// referenced by any usage-accrual, billing-hold, or reconciliation code path.
// A grandfathered user must be billed for manual dialer / AI voice / AI SMS /
// phone-number usage exactly like an ordinary paid-AI user.
const USAGE_BILLING_FILES = [
  "lib/billing/trackAiDialerSessionUsage.ts",
  "lib/billing/trackAiDialerUsage.ts",
  "lib/billing/trackUsage.ts",
  "lib/billing/usageAccrualLedger.ts",
  "lib/billing/reconcileNightly.ts",
  "lib/billing/shouldBill.ts",
  "lib/billing/checkCallingAllowed.ts",
  "lib/billing/aiVoiceUsage.ts",
  "lib/billing/liveTransferUsage.ts",
  "lib/billing/dialerRates.ts",
  "lib/billing/voiceRates.ts",
];

const FORBIDDEN_TOKENS = ["grandfatheredAI", "grandfatheredAIAt", "grandfatheredAIReason", '"grandfathered"', "'grandfathered'"];

describe("grandfathered AI is isolated from usage billing", () => {
  test("no usage-accrual/billing-hold/reconciliation file references grandfatheredAI or the 'grandfathered' source", () => {
    const repoRoot = path.join(__dirname, "..");
    for (const relPath of USAGE_BILLING_FILES) {
      const fullPath = path.join(repoRoot, relPath);
      if (!fs.existsSync(fullPath)) continue; // file may not exist in every checkout state
      const contents = fs.readFileSync(fullPath, "utf8");
      for (const token of FORBIDDEN_TOKENS) {
        expect(contents.includes(token)).toBe(false);
      }
    }
  });

  test("computeAIEntitlement and computeHasAIForCustomer never write billingBlocked/skipBilling/usage-hold fields", () => {
    const repoRoot = path.join(__dirname, "..");
    const entitlementFiles = [
      "lib/billing/computeAIEntitlement.ts",
      "lib/billing/computeHasAIForCustomer.ts",
    ];
    // Checked as object-property/assignment writes ("field:" or "field ="),
    // not bare substring — these two files' doc comments legitimately
    // *mention* ADMIN_FREE_AI_EMAILS as the reason it's kept out of scope.
    const forbiddenWrites = ["billingBlocked:", "skipBilling:", "usageBillingHold:", "aiDialerBillingHold:", "ADMIN_FREE_AI_EMAILS."];
    for (const relPath of entitlementFiles) {
      const code = fs
        .readFileSync(path.join(repoRoot, relPath), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "") // strip block comments
        .replace(/\/\/.*$/gm, ""); // strip line comments
      for (const token of forbiddenWrites) {
        expect(code.includes(token)).toBe(false);
      }
    }
  });

  test("the migration script never calls a Stripe write/create/update method", () => {
    const repoRoot = path.join(__dirname, "..");
    const code = fs
      .readFileSync(path.join(repoRoot, "scripts/migrations/grandfather-legacy-ai-users.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const forbiddenStripeCalls = [
      "subscriptions.create(",
      "subscriptions.update(",
      "subscriptionItems.create(",
      "subscriptionItems.update(",
      "invoiceItems.create(",
      "invoices.create(",
      "coupons.create(",
      "prices.create(",
    ];
    for (const call of forbiddenStripeCalls) {
      expect(code.includes(call)).toBe(false);
    }
    // Only ever reads Stripe (list/retrieve). Reading planCode in a query
    // projection is fine (informational only) — what matters is that the
    // actual $set write block never includes planCode/stripeSubscriptionId/
    // billingBlocked/skipBilling.
    expect(code.includes("stripe.subscriptions.list(")).toBe(true);
    const setBlockMatch = code.match(/\$set:\s*{\s*grandfatheredAI:[\s\S]*?}\s*,?\s*}/);
    expect(setBlockMatch).not.toBeNull();
    const setBlock = setBlockMatch![0];
    expect(setBlock.includes("billingBlocked")).toBe(false);
    expect(setBlock.includes("skipBilling")).toBe(false);
    expect(setBlock.includes("planCode")).toBe(false);
    expect(setBlock.includes("stripeSubscriptionId")).toBe(false);
    expect(setBlock.includes("stripePriceId")).toBe(false);
  });
});

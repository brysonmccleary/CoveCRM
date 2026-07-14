import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(t|j)sx?$": [
      "@swc/jest",
      {
        jsc: {
          target: "es2020",
          parser: { syntax: "typescript", tsx: false },
        },
      },
    ],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: [
    "**/__tests__/ai-session.sim.test.ts",
    "**/__tests__/ai-voice.sim.test.ts",
    "**/__tests__/import-field-registry.test.ts",
    "**/__tests__/lead-foundations.test.ts",
    "**/__tests__/number-reputation.test.ts",
    "**/__tests__/p0-security-remediation.test.ts",
    "**/__tests__/p1-security-remediation.test.ts",
    "**/__tests__/payout-double-pay-remediation.test.ts",
    "**/__tests__/dialer-billing-rates.test.ts",
    "**/__tests__/billing-ledger-safety.test.ts",
    "**/__tests__/billing-index-migration.test.ts",
    "**/__tests__/billing-production-flows.test.ts",
    "**/__tests__/billing-topup-idempotency.test.ts",
    "**/__tests__/billing-reconciliation-cron.test.ts",
    "**/__tests__/assistant-sidebar-path.test.ts",
    "**/__tests__/assistant-lead-tools.test.ts",
    "**/__tests__/chat-assistant-tool-loop.test.ts",
    "**/__tests__/missed-call-text-back.test.ts",
    "**/__tests__/review-request-automation.test.ts",
    "**/__tests__/meta-webhook-idempotency.test.ts",
    "**/__tests__/affiliate-payout-retry.test.ts",
    "**/__tests__/lead-type-inheritance.test.ts",
    "**/__tests__/folder-settings-lead-type.test.ts",
    "**/__tests__/sheets-import-lead-type.test.ts",
    "**/__tests__/assistant-lead-management-tools.test.ts",
    "**/__tests__/bulk-text-leads.test.ts",
    "**/__tests__/schedule-appointment-tool.test.ts",
    "**/__tests__/kimi-fallback-wrapper.test.ts",
    "**/__tests__/kimi-fallback-site-wiring.test.ts",
    "**/__tests__/ai-provider-adapters.test.ts",
    "**/__tests__/kimi-migration-simulation.test.ts",
  ],
  testTimeout: 15000,
  verbose: true,
};

export default config;

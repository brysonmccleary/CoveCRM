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
    "**/__tests__/p0-security-remediation.test.ts",
    "**/__tests__/payout-double-pay-remediation.test.ts",
    "**/__tests__/dialer-billing-rates.test.ts",
  ],
  testTimeout: 15000,
  verbose: true,
};

export default config;

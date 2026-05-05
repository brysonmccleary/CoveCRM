// scripts/doi-parse.ts
// Wrapper script to parse discovery pages for DOI agents.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import { parseAgentPages } from "./parse-agent-pages";

export async function runDoiParse(limit?: number) {
  return parseAgentPages(limit);
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await runDoiParse();
    console.log(
      `[doi-parse] processed=${summary.processed} parsed=${summary.parsed} failed=${summary.failed}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[doi-parse] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

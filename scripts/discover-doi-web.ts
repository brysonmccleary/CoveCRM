// scripts/discover-doi-web.ts
// Wrapper around deterministic discovery so cron jobs can target this entrypoint.
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import { searchAgentsBatch } from "./search-agent-web";

export async function discoverDoiWebBatch(limit?: number) {
  return searchAgentsBatch(limit);
}

if (require.main === module) {
  (async () => {
    await mongooseConnect();
    const summary = await discoverDoiWebBatch();
    console.log(
      `[discover-doi-web] processed=${summary.processed} candidates=${summary.candidates} reachable=${summary.reachable} inserted=${summary.saved} empty=${summary.empty}`
    );
    process.exit(0);
  })().catch((err) => {
    console.error("[discover-doi-web] Fatal error:", err?.message || err);
    process.exit(1);
  });
}

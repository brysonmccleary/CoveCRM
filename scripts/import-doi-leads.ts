// scripts/import-doi-leads.ts
// Standalone runner: connects to MongoDB and imports DOI leads from FL + TX.
// Usage: npx tsx scripts/import-doi-leads.ts
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import mongooseConnect from "../lib/mongooseConnect";
import { scrapeAllStates, StateImportResult } from "./scrape-doi";

async function main() {
  console.log("[import-doi-leads] Connecting to MongoDB…");
  await mongooseConnect();
  console.log("[import-doi-leads] Connected. Starting import…\n");

  const started = Date.now();
  const result = await scrapeAllStates();
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // ── Summary table ────────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────────");
  console.log(" DOI Lead Import Summary");
  console.log("─────────────────────────────────────────────────────");

  const stateKeys = Object.keys(result.byState);
  if (stateKeys.length === 0) {
    console.log(" No states processed.");
  } else {
    const colW = 12;
    const header = [
      "State".padEnd(8),
      "Imported".padStart(colW),
      "Updated".padStart(colW),
      "Skipped".padStart(colW),
      "Errors".padStart(colW),
    ].join(" ");
    console.log(" " + header);
    console.log(" " + "─".repeat(header.length));

    for (const state of stateKeys) {
      const s: StateImportResult = result.byState[state];
      const row = [
        state.padEnd(8),
        String(s.imported).padStart(colW),
        String(s.updated).padStart(colW),
        String(s.skipped).padStart(colW),
        String(s.errors).padStart(colW),
      ].join(" ");
      console.log(" " + row);
    }

    console.log(" " + "─".repeat(header.length));
    const totals = [
      "TOTAL".padEnd(8),
      String(result.totalImported).padStart(colW),
      String(result.totalUpdated).padStart(colW),
      String(result.totalSkipped).padStart(colW),
      String(result.totalErrors).padStart(colW),
    ].join(" ");
    console.log(" " + totals);
  }

  console.log("─────────────────────────────────────────────────────");
  console.log(` Elapsed: ${elapsed}s`);
  console.log("─────────────────────────────────────────────────────\n");

  process.exit(0);
}

main().catch((err) => {
  console.error("[import-doi-leads] Fatal error:", err?.message || err);
  process.exit(1);
});

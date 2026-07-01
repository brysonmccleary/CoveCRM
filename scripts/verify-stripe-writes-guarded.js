#!/usr/bin/env node
// Verifies that every Stripe write call in the codebase is inside a file that
// imports assertStripeWritesEnabled. Fails (exit 1) if any unguarded file is found.

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// Stripe write methods that must be guarded
const WRITE_PATTERNS = [
  "invoiceItems.create",
  "invoices.create",
  "invoices.finalizeInvoice",
  "invoices.pay",
  "paymentIntents.create",
  "subscriptions.create",
  "subscriptions.update",
  "subscriptions.cancel",
  "checkout.sessions.create",
  "subscriptionItems.create",
  "subscriptionItems.update",
  "usageRecords.create",
  "customers.update",
  "customers.create",
  "transfers.create",
  "setupIntents.create",
];

function rg(pattern, flags = "") {
  try {
    return execSync(
      `rg --type ts --type js -l ${flags} "${pattern}" "${ROOT}"`,
      { encoding: "utf8" }
    )
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const GUARD_IMPORT = "assertStripeWritesEnabled";
// Files that are allowed to contain write patterns without the guard
// (the guard itself, types/interfaces, test fixtures, this script)
const ALLOWED_WITHOUT_GUARD = [
  "assertStripeWritesEnabled.ts",
  "verify-stripe-writes-guarded.js",
];

let unguarded = [];

for (const pattern of WRITE_PATTERNS) {
  const files = rg(pattern);
  for (const file of files) {
    // Skip non-source files (node_modules, .next, dist, _share backups)
    if (
      file.includes("node_modules") ||
      file.includes("/.next/") ||
      file.includes("/dist/") ||
      file.includes("/_share/")
    ) {
      continue;
    }
    const basename = path.basename(file);
    if (ALLOWED_WITHOUT_GUARD.some((a) => basename.includes(a))) continue;

    // Check whether the file also imports the guard
    const guardFiles = rg(GUARD_IMPORT, "");
    if (!guardFiles.includes(file)) {
      unguarded.push({ file, pattern });
    }
  }
}

// Deduplicate
const seen = new Set();
unguarded = unguarded.filter(({ file, pattern }) => {
  const key = `${file}:${pattern}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

if (unguarded.length === 0) {
  console.log("✅ All Stripe write calls are in guarded files.");
  process.exit(0);
} else {
  console.error("❌ Unguarded Stripe write calls found:");
  for (const { file, pattern } of unguarded) {
    console.error(`  ${pattern}  →  ${file}`);
  }
  process.exit(1);
}

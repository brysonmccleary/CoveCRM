/**
 * scripts/migrations/grandfather-legacy-ai-users.ts
 *
 * One-time, idempotent migration: grants durable, free AI entitlement
 * (grandfatheredAI=true, hasAI=true, aiEntitlementSource="grandfathered") to
 * the cohort of existing users who are on a legacy (pre-pricing-migration)
 * Stripe base-plan price, so their AI feature access matches a current $150
 * AI-plan user without ever charging them the $150 plan or $50 upgrade add-on.
 *
 * Never touches Stripe (no subscription/subscription-item writes, no coupons,
 * no $0 price), never touches planCode, stripeSubscriptionId, stripePriceId,
 * billingBlocked, skipBilling, or ADMIN_FREE_AI_EMAILS, and never touches any
 * usage-accrual field.
 *
 * Candidate membership is verified LIVE against Stripe on every run — the
 * Mongo-cached stripePriceId/planCode fields are known to go stale (they get
 * overwritten by unrelated phone-number-subscription webhook events), so they
 * are never trusted as the source of truth for cohort membership.
 *
 * Every excluded/flagged candidate is printed with its exact classification
 * reason — nothing is silently assumed to qualify just for being on the
 * legacy price.
 *
 * Dry-run (default): tsx scripts/migrations/grandfather-legacy-ai-users.ts
 * Write:              APPLY=1 tsx scripts/migrations/grandfather-legacy-ai-users.ts
 *
 * Credentials: this script NEVER reads .env, .env.local, or any checked-in/
 * pulled .env.vercel.* snapshot for STRIPE_SECRET_KEY or MONGODB_URI — those
 * go stale (a stale key previously caused this migration to silently report
 * 0 candidates). On every run it pulls the CURRENT Vercel Production
 * environment into an os.tmpdir() file, parses just that file's contents,
 * and deletes it immediately after parsing. The secret values are never
 * logged/printed anywhere.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { parse as parseDotenv } from "dotenv";
import Stripe from "stripe";
import mongoose from "mongoose";

const APPLY = process.env.APPLY === "1";

/**
 * Pulls the current Vercel Production environment into a temporary,
 * untracked file (outside the repo, in the OS temp dir), parses it, and
 * deletes the file immediately — before returning. Never logs its contents.
 */
function loadFreshProductionCredentials(): { STRIPE_SECRET_KEY: string; MONGODB_URI: string; all: Record<string, string> } {
  const tempPath = path.join(os.tmpdir(), `covecrm-prod-env-${process.pid}-${Date.now()}.env`);
  let parsed: Record<string, string> = {};
  try {
    console.log("🔄 Pulling current Vercel Production environment (fresh, not from any local .env)...");
    execFileSync("npx", ["vercel", "env", "pull", tempPath, "--environment=production", "--yes"], {
      stdio: ["ignore", "ignore", "inherit"],
    });
    parsed = parseDotenv(fs.readFileSync(tempPath));
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  const stripeKey = (parsed.STRIPE_SECRET_KEY || "").trim();
  const mongoUri = (parsed.MONGODB_URI || "").trim();

  if (!stripeKey) {
    throw new Error("Fresh Vercel Production pull did not contain STRIPE_SECRET_KEY.");
  }
  if (!stripeKey.startsWith("sk_live_")) {
    throw new Error("Fresh Vercel Production STRIPE_SECRET_KEY does not look like a live key (expected sk_live_ prefix).");
  }
  if (!mongoUri) {
    throw new Error("Fresh Vercel Production pull did not contain MONGODB_URI.");
  }

  console.log("✅ Loaded fresh STRIPE_SECRET_KEY and MONGODB_URI from Vercel Production (temp file deleted, values not logged).\n");
  return { STRIPE_SECRET_KEY: stripeKey, MONGODB_URI: mongoUri, all: parsed };
}

// Computed inside main(), AFTER fresh Vercel Production credentials are
// loaded — these must never be read from process.env at module-load time,
// since that would race with (and could fall back to) a stale local .env.
function buildLegacyPriceIds(env: Record<string, string>): string[] {
  return (env.LEGACY_AI_GRANDFATHER_PRICE_IDS || "price_1RoAGJDF9aEsjVyJV2wARrFp")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildCurrentAIPriceIds(env: Record<string, string>): string[] {
  return [env.STRIPE_PRICE_ID_AI_MONTHLY, env.AI_Upgrade, env.CoveCRM_AI_Plan, env.CoveCRM_AI_Annual_Plan]
    .map((v) => (v || "").trim())
    .filter(Boolean);
}

function buildSanityCutoff(env: Record<string, string>): Date {
  return new Date(env.AI_GRANDFATHER_SANITY_CUTOFF || "2026-06-25T00:00:00.000Z");
}

// Narrowly scoped, explicit business-approved exceptions to the paid-invoice
// safeguard — NOT a general relaxation of it. An email here still has to
// pass every other live-verification gate (real Stripe customer, on the
// legacy price, not already paying for AI, not admin/internal/test) exactly
// like anyone else; the ONLY rule it's exempt from is "never_paid". Adding a
// name here must be a specific, individually-approved decision — see
// grandfatheredAIReason in the write payload for the audit trail.
function buildManualExceptions(env: Record<string, string>): Set<string> {
  return new Set(
    (env.GRANDFATHERED_AI_MANUAL_EXCEPTIONS || "lukeclementfinancial@gmail.com")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

const TEST_EMAIL_PATTERNS = [/\+test/i, /test@/i, /@example\.com$/i, /fake/i, /\bdemo\b/i];

// Known internal/house/support accounts — never real customers, regardless
// of what Stripe subscription they happen to carry.
const INTERNAL_STAFF_EMAILS = new Set(["support@covecrm.com", "admin@covecrm.com"]);

type Classification =
  | "real_customer_legacy_price_verified"
  | "manual_exception_approved"
  | "already_has_paid_ai"
  | "inactive_legacy_subscription"
  | "never_paid"
  | "unverified_email"
  | "test_pattern_match"
  | "stripe_test_mode"
  | "admin_excluded"
  | "internal_staff_excluded"
  | "no_legacy_stripe_item";

type CandidateResult = {
  _id: string;
  email: string;
  createdAt: Date | null;
  hasEverPaid: boolean;
  emailVerified: boolean;
  subscriptionStatus: string | null;
  stripeCustomerId: string;
  legacySubscriptionId: string | null;
  legacySubscriptionStatus: string | null;
  legacyPriceId: string | null;
  paidInvoiceCount: number;
  classification: Classification;
  willGrant: boolean;
  sanityFlag: "ok" | "createdAt_after_migration_cutoff_verify_manually";
};

async function main() {
  const creds = loadFreshProductionCredentials();
  const LEGACY_AI_GRANDFATHER_PRICE_IDS = buildLegacyPriceIds(creds.all);
  const CURRENT_AI_PRICE_IDS = buildCurrentAIPriceIds(creds.all);
  const MIGRATION_SANITY_CUTOFF = buildSanityCutoff(creds.all);
  const MANUAL_EXCEPTIONS = buildManualExceptions(creds.all);
  if (MANUAL_EXCEPTIONS.size > 0) {
    console.log(`Manual exception allowlist (paid-invoice safeguard only): ${[...MANUAL_EXCEPTIONS].join(", ")}\n`);
  }

  const stripe = new Stripe(creds.STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" as any });

  await mongoose.connect(creds.MONGODB_URI);
  console.log("✅ Connected to MongoDB (fresh Vercel Production URI)");
  console.log(APPLY ? "✍️  WRITE MODE (APPLY=1)" : "🔍 DRY RUN — no writes will be made");
  console.log(`Legacy price IDs: ${LEGACY_AI_GRANDFATHER_PRICE_IDS.join(", ")}\n`);

  const db = mongoose.connection.db!;
  const usersCol = db.collection("users");

  const candidates = await usersCol
    .find({
      role: { $ne: "admin" },
      hasAI: { $ne: true },
      grandfatheredAI: { $ne: true },
      stripeCustomerId: { $exists: true, $nin: [null, ""] },
    })
    .project({
      _id: 1,
      email: 1,
      createdAt: 1,
      hasEverPaid: 1,
      emailVerified: 1,
      subscriptionStatus: 1,
      stripeCustomerId: 1,
      planCode: 1,
    })
    .toArray();

  console.log(`Found ${candidates.length} Mongo-side candidates (pre-Stripe-verification)\n`);

  const results: CandidateResult[] = [];
  let stripeErrorCount = 0;

  for (const u of candidates) {
    const email = String(u.email || "").toLowerCase();
    const customerId = String(u.stripeCustomerId || "").trim();
    process.stdout.write(`  ${email} ... `);

    let subs: Stripe.Subscription[] = [];
    try {
      const list = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        expand: ["data.items.data.price"],
        limit: 100,
      });
      subs = list.data;
    } catch (err: any) {
      // An authentication error means the credential itself is bad — every
      // remaining candidate would fail identically, silently degrading into
      // a misleading "0 candidates" result. Abort the whole run immediately
      // instead of continuing to loop.
      if (err?.type === "StripeAuthenticationError") {
        console.log("⛔ Stripe authentication error\n");
        await mongoose.disconnect();
        throw new Error(
          `Stripe authentication failed while checking ${email}: ${err?.message || err}. ` +
            `Aborting the entire migration — this indicates a bad/expired STRIPE_SECRET_KEY, not a per-user issue.`,
        );
      }
      console.log(`⛔ Stripe error: ${err?.message || err} — skipping this user`);
      stripeErrorCount++;
      continue;
    }

    // Any status — used only to detect "was this ever a legacy-price
    // customer at all" so we can log a classification row. Whether that
    // subscription is currently active/trialing is checked separately below
    // and is a hard requirement, not a bonus signal.
    const legacySub = subs.find((sub) =>
      (sub.items?.data || []).some((it: any) => LEGACY_AI_GRANDFATHER_PRICE_IDS.includes(it?.price?.id))
    );

    if (!legacySub) {
      console.log("— not on a legacy price, skipping (no log entry)");
      continue; // not in cohort at all — don't even log a classification row
    }

    const legacyItem = legacySub.items.data.find((it: any) =>
      LEGACY_AI_GRANDFATHER_PRICE_IDS.includes((it.price as any)?.id)
    );
    const legacyPriceId = (legacyItem?.price as any)?.id || null;

    // Business rule: a canceled/incomplete_expired/unpaid/paused (or any
    // other non-active/trialing) base subscription ends ALL paid access,
    // including grandfathered AI. This gate is checked before the manual
    // exception allowlist, so no exception can ever bypass it (per explicit
    // instruction: only a specific canceled user, individually approved,
    // could ever weaken this — not implemented here).
    const legacySubIsActiveOrTrialing = legacySub.status === "active" || legacySub.status === "trialing";

    const alreadyHasPaidAI = subs.some(
      (sub) =>
        (sub.status === "active" || sub.status === "trialing") &&
        (sub.items?.data || []).some((it: any) => CURRENT_AI_PRICE_IDS.includes(it?.price?.id))
    );

    const isTestModeObject = subs.some((sub) => (sub as any).livemode === false);

    let paidInvoiceCount = 0;
    try {
      const invoices = await stripe.invoices.list({ customer: customerId, status: "paid", limit: 100 });
      paidInvoiceCount = invoices.data.filter((inv) => (inv.amount_paid || 0) > 0).length;
    } catch {
      // leave at 0 — hasEverPaid Mongo flag still gates below
    }

    const sanityFlag: CandidateResult["sanityFlag"] =
      u.createdAt && new Date(u.createdAt) >= MIGRATION_SANITY_CUTOFF
        ? "createdAt_after_migration_cutoff_verify_manually"
        : "ok";

    // Order matters: every gate except the paid-invoice rule ("never_paid")
    // applies identically to a manual-exception email. The exception is
    // checked ONLY at the exact point "never_paid" would otherwise fire —
    // it can never override internal/admin/test/already-has-AI/unverified
    // exclusions, and it never widens who reaches that point.
    let classification: Classification;
    if (INTERNAL_STAFF_EMAILS.has(email)) {
      classification = "internal_staff_excluded";
    } else if (alreadyHasPaidAI) {
      classification = "already_has_paid_ai";
    } else if (!legacySubIsActiveOrTrialing) {
      classification = "inactive_legacy_subscription";
    } else if (TEST_EMAIL_PATTERNS.some((re) => re.test(email))) {
      classification = "test_pattern_match";
    } else if (isTestModeObject) {
      classification = "stripe_test_mode";
    } else if (u.emailVerified !== true) {
      classification = "unverified_email";
    } else if (u.hasEverPaid !== true || paidInvoiceCount === 0) {
      classification = MANUAL_EXCEPTIONS.has(email) ? "manual_exception_approved" : "never_paid";
    } else {
      classification = "real_customer_legacy_price_verified";
    }

    const willGrant =
      classification === "real_customer_legacy_price_verified" || classification === "manual_exception_approved";

    const result: CandidateResult = {
      _id: String(u._id),
      email,
      createdAt: u.createdAt || null,
      hasEverPaid: u.hasEverPaid === true,
      emailVerified: u.emailVerified === true,
      subscriptionStatus: u.subscriptionStatus || null,
      stripeCustomerId: customerId,
      legacySubscriptionId: legacySub.id,
      legacySubscriptionStatus: legacySub.status,
      legacyPriceId,
      paidInvoiceCount,
      classification,
      willGrant,
      sanityFlag,
    };
    results.push(result);
    console.log(`${willGrant ? "✅" : "⏭️ "} ${classification}`);
  }

  // Minimum safety assertion: if there were real Mongo-side candidates but
  // Stripe verification produced zero results BECAUSE of per-candidate
  // errors (not because none of them are genuinely on a legacy price), abort
  // rather than silently reporting "0 candidates" as if it were a clean
  // negative result. This is exactly the failure mode that a stale/expired
  // Stripe key produced previously.
  if (candidates.length > 0 && results.length === 0 && stripeErrorCount > 0) {
    await mongoose.disconnect();
    throw new Error(
      `Safety check failed: found ${candidates.length} Mongo-side candidates but 0 were Stripe-verified, ` +
        `and ${stripeErrorCount} candidate(s) hit a Stripe error. Refusing to report "0 candidates" — ` +
        `this looks like a credential/connectivity problem, not a genuine empty cohort.`,
    );
  }

  console.log(`\nFound ${results.length} legacy-price candidates (${stripeErrorCount} per-candidate Stripe errors, skipped individually).`);
  console.log(JSON.stringify(results, null, 2));

  const toGrant = results.filter((r) => r.willGrant);
  console.log(`\n${toGrant.length} of ${results.length} will be granted grandfathered AI:`);
  for (const r of toGrant) {
    console.log(`  ✅ willGrant=true  ${r.email}  reason=${r.classification} (legacyPriceId=${r.legacyPriceId})`);
  }
  const excluded = results.filter((r) => !r.willGrant);
  if (excluded.length > 0) {
    console.log(`\n${excluded.length} legacy-price candidate(s) excluded:`);
    for (const r of excluded) {
      console.log(`  ⏭️  willGrant=false ${r.email}  reason=${r.classification}`);
    }
  }

  if (!APPLY) {
    console.log("\n🔍 DRY RUN — no writes made. Re-run with APPLY=1 to write.");
    await mongoose.disconnect();
    return;
  }

  const manifestDir = path.join(__dirname, ".rollback-manifests");
  fs.mkdirSync(manifestDir, { recursive: true });
  const manifestPath = path.join(manifestDir, `grandfather-legacy-ai-users.${Date.now()}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      toGrant.map((r) => ({
        _id: r._id,
        email: r.email,
        prior: { hasAI: false, aiEntitlementSource: null, grandfatheredAI: false },
      })),
      null,
      2
    )
  );
  console.log(`Rollback manifest written to ${manifestPath}`);

  for (const r of toGrant) {
    await usersCol.updateOne(
      { _id: new mongoose.Types.ObjectId(r._id) },
      {
        $set: {
          grandfatheredAI: true,
          grandfatheredAIAt: new Date(),
          grandfatheredAIReason:
            r.classification === "manual_exception_approved"
              ? `manual_exception_approved:legacy_price:${r.legacyPriceId}`
              : `legacy_price:${r.legacyPriceId}`,
          hasAI: true,
          aiEntitlementSource: "grandfathered",
        },
      }
    );
    console.log(`✅ Granted grandfathered AI: ${r.email}`);
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// scripts/test-ai-billing-simulation.ts
//
// Standalone end-to-end simulation of AI dialer session-time billing.
//
// Creates a fake AICallSession, runs one billing tick via
// trackAiDialerSessionUsage, verifies MongoDB + Stripe state, then
// always cleans up — even if a step throws.
//
// Run:
//   npx tsx scripts/test-ai-billing-simulation.ts

// ── Env loading MUST happen before any dynamic import of modules
//    that read process.env at init time (e.g. lib/stripe.ts throws
//    if STRIPE_SECRET_KEY is missing when first required).
import { config as dotenvConfig } from "dotenv";
import path from "path";

dotenvConfig({ path: path.resolve(process.cwd(), ".env") });
dotenvConfig({ path: path.resolve(process.cwd(), ".env.production.local"), override: false });
dotenvConfig({ path: path.resolve(process.cwd(), ".env.local"), override: false });

// These models have no stripe dependency — safe to import statically.
import mongoose from "mongoose";
import AICallSessionModel from "@/models/AICallSession";
import UserModel from "@/models/User";

// ── ANSI helpers ──────────────────────────────────────────────────────────────
const G = "\x1b[32m";
const R = "\x1b[31m";
const Y = "\x1b[33m";
const B = "\x1b[1m";
const X = "\x1b[0m";

function pass(msg: string) { console.log(`  ${G}✓ PASS${X}  ${msg}`); }
function fail(msg: string, detail?: string) {
  console.error(`  ${R}✗ FAIL${X}  ${msg}${detail ? `\n         ${detail}` : ""}`);
}
function info(msg: string) { console.log(`  ${Y}ℹ${X}      ${msg}`); }
function section(msg: string) { console.log(`\n${B}${msg}${X}`); }

// ── Constants ─────────────────────────────────────────────────────────────────
const SIM_EMAIL = "bryson,.mccleary1@gmail.com";
// 4h 5m ago — guaranteed to exceed the $20 threshold (4 hr × $5/hr = $20 exactly,
// +5 min of overage ensures we clear 2000 cents even with rounding).
const SESSION_AGE_MS = ((4 * 60) + 5) * 60 * 1000;
// Expected billedSeconds = 4h5m = 14,700 s. Allow ±15 s for execution time.
const EXPECTED_BILLED_SEC = Math.floor(SESSION_AGE_MS / 1000);
const BILLED_SEC_TOLERANCE = 15;
// Expected addCents = round(14700 / 3600 * 500) = round(2041.67) = 2042
const EXPECTED_ACCRUED_CENTS = Math.round((EXPECTED_BILLED_SEC / 3600) * 500);
const SESSION_THRESHOLD_CENTS = 2000;

// ── Stripe helper (raw fetch — avoids the singleton import-time throw) ────────
async function fetchNewStripeInvoices(
  customerId: string,
  afterEpochMs: number
): Promise<{ id: string; status: string; amount_due: number; amount_paid: number }[]> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    info("STRIPE_SECRET_KEY not available — skipping Stripe check");
    return [];
  }
  const afterSec = Math.floor(afterEpochMs / 1000);
  const url =
    `https://api.stripe.com/v1/invoices` +
    `?customer=${encodeURIComponent(customerId)}&limit=10&created[gte]=${afterSec}`;
  try {
    const resp = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(key + ":").toString("base64")}`,
      },
    });
    if (!resp.ok) {
      info(`Stripe API error ${resp.status} — skipping Stripe check`);
      return [];
    }
    const data = (await resp.json()) as any;
    return (data.data || []).filter(
      (inv: any) => inv.amount_due > 0 || inv.amount_paid > 0
    );
  } catch (err: any) {
    info(`Stripe fetch threw: ${err?.message || err}`);
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // ── trackAiDialerSessionUsage is dynamically imported here so that
  //    process.env is fully populated (dotenvConfig calls above ran first)
  //    before lib/stripe.ts is required and checks STRIPE_SECRET_KEY.
  const { trackAiDialerSessionUsage } = await import(
    "@/lib/billing/trackAiDialerSessionUsage"
  );

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error(`${R}❌ MONGODB_URI not found in env${X}`);
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(`\n${B}══════════════════════════════════════════════${X}`);
  console.log(`${B}   AI BILLING SIMULATION — ${new Date().toISOString()}${X}`);
  console.log(`${B}══════════════════════════════════════════════${X}`);

  let insertedId: string | null = null;
  const simStartMs = Date.now();
  const passes: string[] = [];
  const failures: string[] = [];

  function recordPass(msg: string) { pass(msg); passes.push(msg); }
  function recordFail(msg: string, detail?: string) { fail(msg, detail); failures.push(msg); }

  // ── Pre-flight: resolve user ──────────────────────────────────────────────
  section("[PRE-FLIGHT] Resolving user state...");

  const userBefore = await UserModel.findOne({ email: SIM_EMAIL })
    .select(
      "hasAI stripeCustomerId " +
      "aiDialerAccruedSessionCents aiDialerBilledTotalCents " +
      "aiDialerSessionSeconds aiDialerLastChargedAt"
    )
    .lean();

  if (!userBefore) {
    console.error(`${R}❌ User ${SIM_EMAIL} not found — cannot run simulation${X}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const stripeCustomerId: string | null = (userBefore as any).stripeCustomerId || null;
  const hasAI: boolean = !!(userBefore as any).hasAI;
  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const isAdmin = adminEmails.includes(SIM_EMAIL.toLowerCase());

  const priorAccruedSessionCents = Number((userBefore as any).aiDialerAccruedSessionCents ?? 0);
  const priorBilledTotalCents    = Number((userBefore as any).aiDialerBilledTotalCents ?? 0);
  const priorSessionSeconds      = Number((userBefore as any).aiDialerSessionSeconds ?? 0);

  info(`User:               ${SIM_EMAIL}`);
  info(`hasAI:              ${hasAI}`);
  info(`stripeCustomerId:   ${stripeCustomerId ?? "(none)"}`);
  info(`isAdmin:            ${isAdmin}  (ADMIN_EMAILS="${process.env.ADMIN_EMAILS ?? ""}")`);
  info(`Prior accruedCents: ${priorAccruedSessionCents}`);
  info(`Prior billedTotal:  ${priorBilledTotalCents}`);
  info(`Prior sessSeconds:  ${priorSessionSeconds}`);

  // Predict which billing path will be taken
  let expectedPath: "admin" | "no-hasAI" | "no-stripe" | "full-billing";
  if (isAdmin) {
    expectedPath = "admin";
    info("Expected path: ADMIN — seconds tracked, no cents accrued, no Stripe charge");
  } else if (!hasAI) {
    expectedPath = "no-hasAI";
    info("Expected path: NO-HASAI — seconds tracked, no Stripe charge");
  } else if (!stripeCustomerId) {
    expectedPath = "no-stripe";
    info("Expected path: NO-STRIPE-ID — cents accrued, no Stripe charge");
  } else {
    expectedPath = "full-billing";
    info(`Expected path: FULL-BILLING — cents accrued, Stripe charge if >= ${SESSION_THRESHOLD_CENTS} cents`);
  }

  try {
    // ────────────────────────────────────────────────────────────────────────
    // SETUP — Insert fake AICallSession
    // ────────────────────────────────────────────────────────────────────────
    section("[SETUP] Inserting fake AICallSession...");

    const startedAt = new Date(simStartMs - SESSION_AGE_MS);
    const fakeSession = await AICallSessionModel.create({
      userEmail: SIM_EMAIL,
      status: "running",
      startedAt,
      billedSeconds: 0,
      lastBilledAt: null,
      leadIds: [],
      folderId: new mongoose.Types.ObjectId(),
      fromNumber: "+15550000000",
      voiceKey: "simulation",
      scriptKey: "simulation_test",
      total: 0,
      lastIndex: -1,
    });

    insertedId = String(fakeSession._id);
    info(`sessionId:  ${insertedId}`);
    info(`startedAt:  ${startedAt.toISOString()}`);
    info(`age:        ${(SESSION_AGE_MS / 60000).toFixed(1)} min (~${(SESSION_AGE_MS / 3600000).toFixed(2)} hr)`);
    info(`expected billedSeconds:  ≈${EXPECTED_BILLED_SEC}`);
    info(`expected addCents:       ≈${EXPECTED_ACCRUED_CENTS}`);

    // ────────────────────────────────────────────────────────────────────────
    // STEP 1 — Run one billing tick
    // ────────────────────────────────────────────────────────────────────────
    section("[STEP 1] Calling trackAiDialerSessionUsage...");

    const tickStart = Date.now();
    let billingResult: { billedSeconds: number; accrued: number } | null = null;
    let billingError: string | null = null;

    try {
      billingResult = await trackAiDialerSessionUsage({
        sessionId: insertedId,
        userEmail: SIM_EMAIL,
      });
    } catch (err: any) {
      billingError = err?.message || String(err);
    }

    const tickMs = Date.now() - tickStart;
    info(`Completed in ${tickMs}ms`);
    info(`Result:     ${billingResult !== null ? JSON.stringify(billingResult) : "null"}`);
    if (billingError) info(`Error:      ${billingError}`);

    // ────────────────────────────────────────────────────────────────────────
    // VERIFY — Query MongoDB state
    // ────────────────────────────────────────────────────────────────────────
    section("[VERIFY] Checking MongoDB state...");

    const sessionAfter = await AICallSessionModel.findById(insertedId)
      .select("billedSeconds lastBilledAt")
      .lean();

    const userAfter = await UserModel.findOne({ email: SIM_EMAIL })
      .select(
        "aiDialerAccruedSessionCents aiDialerBilledTotalCents " +
        "aiDialerSessionSeconds aiDialerLastChargedAt"
      )
      .lean();

    const billedSec      = Number((sessionAfter as any)?.billedSeconds ?? 0);
    const lastBilledAt   = (sessionAfter as any)?.lastBilledAt as Date | null;
    const newAccruedCents = Number((userAfter as any)?.aiDialerAccruedSessionCents ?? 0);
    const newBilledTotal  = Number((userAfter as any)?.aiDialerBilledTotalCents ?? 0);
    const newSessSeconds  = Number((userAfter as any)?.aiDialerSessionSeconds ?? 0);
    const newLastCharged  = (userAfter as any)?.aiDialerLastChargedAt as Date | null;

    info(`Session.billedSeconds:              ${billedSec}  (expected ≈${EXPECTED_BILLED_SEC})`);
    info(`Session.lastBilledAt:               ${lastBilledAt?.toISOString() ?? "null"}`);
    info(`User.aiDialerSessionSeconds:        ${newSessSeconds}  (was ${priorSessionSeconds})`);
    info(`User.aiDialerAccruedSessionCents:   ${newAccruedCents}  (was ${priorAccruedSessionCents})`);
    info(`User.aiDialerBilledTotalCents:      ${newBilledTotal}  (was ${priorBilledTotalCents})`);
    info(`User.aiDialerLastChargedAt:         ${newLastCharged?.toISOString() ?? "null"}`);

    // ────────────────────────────────────────────────────────────────────────
    // Check Stripe
    // ────────────────────────────────────────────────────────────────────────
    section("[STRIPE] Checking for new invoice...");

    let stripeInvoices: { id: string; status: string; amount_due: number; amount_paid: number }[] = [];
    if (stripeCustomerId) {
      stripeInvoices = await fetchNewStripeInvoices(stripeCustomerId, simStartMs);
      if (stripeInvoices.length > 0) {
        for (const inv of stripeInvoices) {
          info(`Invoice: ${inv.id} | status: ${inv.status} | amount_due: ${inv.amount_due} | amount_paid: ${inv.amount_paid}`);
        }
      } else {
        info("No new non-zero invoices found since simulation started");
      }
    } else {
      info("No stripeCustomerId on user — Stripe check skipped");
    }

    // ────────────────────────────────────────────────────────────────────────
    // ASSERTIONS
    // ────────────────────────────────────────────────────────────────────────
    section("[ASSERTIONS]");

    // A. Billing returned a result (not null)
    if (billingError) {
      recordFail("trackAiDialerSessionUsage threw an exception", billingError);
    } else if (billingResult === null) {
      recordFail("trackAiDialerSessionUsage returned null (session not found or optimistic lock lost)");
    } else {
      recordPass("trackAiDialerSessionUsage returned a non-null result");
    }

    // B. Session.billedSeconds correct
    const billedSecDiff = Math.abs(billedSec - EXPECTED_BILLED_SEC);
    if (billedSec === 0 && billingResult === null) {
      recordFail("Session.billedSeconds not updated (billing returned null)");
    } else if (billedSecDiff <= BILLED_SEC_TOLERANCE) {
      recordPass(`Session.billedSeconds ≈ ${billedSec} (expected ≈${EXPECTED_BILLED_SEC}, diff=${billedSecDiff}s)`);
    } else {
      recordFail(
        "Session.billedSeconds is wrong",
        `got ${billedSec}, expected ≈${EXPECTED_BILLED_SEC}, diff=${billedSecDiff}s`
      );
    }

    // C. Session.lastBilledAt set
    if (lastBilledAt && lastBilledAt.getTime() >= simStartMs) {
      recordPass(`Session.lastBilledAt was set: ${lastBilledAt.toISOString()}`);
    } else if (lastBilledAt) {
      recordFail("Session.lastBilledAt set but timestamp is in the past", lastBilledAt.toISOString());
    } else {
      recordFail("Session.lastBilledAt was not set");
    }

    // D–G. Path-dependent assertions
    if (expectedPath === "admin") {
      // Admin: only aiDialerSessionSeconds updated; no cents, no Stripe
      const secondsDelta = newSessSeconds - priorSessionSeconds;
      if (secondsDelta > 0 && Math.abs(secondsDelta - EXPECTED_BILLED_SEC) <= BILLED_SEC_TOLERANCE) {
        recordPass(`User.aiDialerSessionSeconds incremented correctly (+${secondsDelta}s, admin path)`);
      } else if (secondsDelta <= 0) {
        recordFail("User.aiDialerSessionSeconds not incremented (admin path)", `delta=${secondsDelta}`);
      } else {
        recordFail("User.aiDialerSessionSeconds increment out of range", `delta=${secondsDelta}, expected ≈${EXPECTED_BILLED_SEC}`);
      }
      if (newAccruedCents === priorAccruedSessionCents) {
        recordPass("aiDialerAccruedSessionCents unchanged (admin: no billing)");
      } else {
        recordFail(
          "aiDialerAccruedSessionCents changed unexpectedly for admin",
          `was ${priorAccruedSessionCents}, now ${newAccruedCents}`
        );
      }
      if (billingResult?.accrued === 0) {
        recordPass("result.accrued === 0 (correct for admin)");
      } else {
        recordFail(`result.accrued should be 0 for admin, got ${billingResult?.accrued}`);
      }
      info("Stripe charge: NOT expected (admin account)");

    } else if (expectedPath === "no-hasAI") {
      const secondsDelta = newSessSeconds - priorSessionSeconds;
      if (secondsDelta > 0) {
        recordPass(`User.aiDialerSessionSeconds incremented (+${secondsDelta}s, no-hasAI path)`);
      } else {
        recordFail("User.aiDialerSessionSeconds not incremented (no-hasAI path)");
      }
      info("Stripe charge: NOT expected (hasAI=false)");

    } else if (expectedPath === "no-stripe") {
      const centsDelta = newAccruedCents - priorAccruedSessionCents;
      if (Math.abs(centsDelta - EXPECTED_ACCRUED_CENTS) <= 5) {
        recordPass(`aiDialerAccruedSessionCents accrued: +${centsDelta} cents (expected ≈+${EXPECTED_ACCRUED_CENTS})`);
      } else {
        recordFail(
          "aiDialerAccruedSessionCents delta wrong",
          `got +${centsDelta}, expected ≈+${EXPECTED_ACCRUED_CENTS}`
        );
      }
      info("Stripe charge: NOT expected (no stripeCustomerId)");

    } else {
      // full-billing path
      const centsDelta = newAccruedCents - priorAccruedSessionCents;
      const totalAfterAccrual = priorAccruedSessionCents + EXPECTED_ACCRUED_CENTS;
      const expectedCharge = Math.floor(totalAfterAccrual / SESSION_THRESHOLD_CENTS) * SESSION_THRESHOLD_CENTS;
      const expectedRemaining = totalAfterAccrual - expectedCharge;

      // Cents accrued correctly
      if (Math.abs(centsDelta - (EXPECTED_ACCRUED_CENTS - expectedCharge)) <= 5) {
        recordPass(`aiDialerAccruedSessionCents net delta: ${centsDelta >= 0 ? "+" : ""}${centsDelta} (accrued ≈${EXPECTED_ACCRUED_CENTS}, charged ${expectedCharge})`);
      } else {
        // If no Stripe charge happened, expect the full accrual
        if (Math.abs(centsDelta - EXPECTED_ACCRUED_CENTS) <= 5) {
          recordFail(
            "aiDialerAccruedSessionCents accrued but Stripe charge did NOT fire (cents not decremented)",
            `delta=+${centsDelta}, expected net delta ≈${EXPECTED_ACCRUED_CENTS - expectedCharge}`
          );
        } else {
          recordFail(
            "aiDialerAccruedSessionCents delta unexpected",
            `got ${centsDelta >= 0 ? "+" : ""}${centsDelta}`
          );
        }
      }

      // Stripe invoice
      if (totalAfterAccrual >= SESSION_THRESHOLD_CENTS) {
        if (stripeInvoices.length > 0) {
          const inv = stripeInvoices[0];
          recordPass(`Stripe invoice created: ${inv.id} (status=${inv.status})`);
          const chargedAmount = inv.amount_paid || inv.amount_due;
          if (chargedAmount === expectedCharge) {
            recordPass(`Stripe amount correct: ${chargedAmount} cents ($${(chargedAmount / 100).toFixed(2)})`);
          } else {
            recordFail(
              "Stripe invoice amount wrong",
              `got ${chargedAmount} cents, expected ${expectedCharge} cents`
            );
          }
        } else {
          recordFail(
            "Stripe invoice expected but not found",
            `threshold=${SESSION_THRESHOLD_CENTS}, totalAfterAccrual≈${totalAfterAccrual}`
          );
        }
        if (newLastCharged && newLastCharged.getTime() >= simStartMs) {
          recordPass(`aiDialerLastChargedAt set: ${newLastCharged.toISOString()}`);
        } else {
          recordFail("aiDialerLastChargedAt not set after expected Stripe charge");
        }
        if (newBilledTotal > priorBilledTotalCents) {
          recordPass(`aiDialerBilledTotalCents incremented: ${priorBilledTotalCents} → ${newBilledTotal}`);
        } else {
          recordFail(
            "aiDialerBilledTotalCents not incremented",
            `was ${priorBilledTotalCents}, still ${newBilledTotal}`
          );
        }
      } else {
        info(`Accrual (${totalAfterAccrual} cents) below threshold — no Stripe charge expected`);
      }
    }

  } finally {
    // ────────────────────────────────────────────────────────────────────────
    // CLEANUP — always runs
    // ────────────────────────────────────────────────────────────────────────
    section("[CLEANUP]");

    if (insertedId) {
      try {
        const del = await AICallSessionModel.deleteOne({
          _id: new mongoose.Types.ObjectId(insertedId),
        });
        info(`Deleted fake session ${insertedId}: deletedCount=${del.deletedCount}`);
      } catch (err: any) {
        info(`Failed to delete fake session: ${err?.message || err}`);
      }
    }

    try {
      await UserModel.updateOne(
        { email: SIM_EMAIL },
        {
          $set: {
            aiDialerAccruedSessionCents: 0,
            aiDialerBilledTotalCents: 0,
            aiDialerSessionSeconds: 0,
            aiDialerLastChargedAt: null,
            aiDialerBillingLockAt: null,
            aiDialerBillingLockOwner: null,
            aiDialerBillingLockExpiresAt: null,
          },
        }
      );
      info(`Reset ${SIM_EMAIL} billing fields to zero`);
    } catch (err: any) {
      info(`Failed to reset user billing fields: ${err?.message || err}`);
    }

    console.log(`  CLEANUP COMPLETE`);

    await mongoose.disconnect();
  }

  // ────────────────────────────────────────────────────────────────────────────
  // FINAL REPORT
  // ────────────────────────────────────────────────────────────────────────────
  section("══════════════════════════════════════════════");
  console.log(`${B}  FINAL REPORT${X}`);
  section("══════════════════════════════════════════════");
  console.log(`  Billing path: ${B}${expectedPath}${X}`);
  console.log(`  Passed: ${G}${passes.length}${X}   Failed: ${R}${failures.length}${X}`);
  console.log();

  if (failures.length === 0) {
    console.log(`${G}${B}  ✓ ALL PASS${X}`);
  } else {
    console.log(`${R}${B}  ✗ FAILURES:${X}`);
    for (const f of failures) console.log(`    ${R}• ${f}${X}`);
    console.log();
    process.exit(1);
  }
  console.log();
}

main().catch((err) => {
  console.error(`\n${R}Fatal error:${X}`, err?.message || err);
  process.exit(1);
});

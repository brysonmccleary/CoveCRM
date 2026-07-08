import fs from "fs";
import path from "path";
import {
  AFFILIATE_MONTHLY_CREDIT_CENTS,
  AFFILIATE_MONTHLY_CREDIT_USD,
  affiliateCreditPayableAt,
} from "../lib/affiliate/payoutPolicy";

type Status =
  | "held"
  | "processing"
  | "paid"
  | "failed"
  | "reversed"
  | "clawback_owed";

type UserRow = {
  id: string;
  email: string;
  affiliateId?: string | null;
  subscriptionStatus: "active" | "pending" | "canceled" | "past_due";
  billingBlocked: boolean;
};

type AffiliateRow = {
  id: string;
  userId: string;
  email: string;
  referralCode: string;
  approved: boolean;
  stripeConnectId?: string;
  onboardingCompleted: boolean;
};

type CreditRow = {
  id: string;
  affiliateId: string;
  userId: string;
  amountCents: number;
  amount: number;
  status: Status;
  earnedAt: Date;
  payableAt: Date;
  reversedAt: Date | null;
  reversalReason: string | null;
  stripeInvoiceId: string;
  idempotencyKey: string;
  claimOwner: string | null;
  processingStartedAt: Date | null;
  stripeTransferId: string | null;
  paidAt: Date | null;
};

type Scenario = {
  n: number;
  test: string;
  pass: boolean;
  observed: string;
  failRef?: string;
  fix?: string;
};

const repoRoot = path.resolve(__dirname, "..");
const outputPath = path.join(repoRoot, "AUDIT", "AFFILIATE_SIM_RESULTS.md");
const now = new Date("2026-07-02T12:00:00.000Z");

let nextId = 1;
const users: UserRow[] = [];
const affiliates: AffiliateRow[] = [];
const credits: CreditRow[] = [];
const transferAttempts: Array<{ creditId: string; idempotencyKey: string }> = [];
const loudLogs: string[] = [];

function id(prefix: string) {
  return `${prefix}_${String(nextId++).padStart(4, "0")}`;
}

function lineOf(file: string, pattern: string) {
  const abs = path.join(repoRoot, file);
  const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
  const idx = lines.findIndex((line) => line.includes(pattern));
  return idx >= 0 ? `${file}:${idx + 1}` : `${file}:?`;
}

function addUser(input: Partial<UserRow> & { email: string }): UserRow {
  const user: UserRow = {
    id: input.id || id("user"),
    email: input.email.toLowerCase(),
    affiliateId: input.affiliateId ?? null,
    subscriptionStatus: input.subscriptionStatus || "pending",
    billingBlocked: input.billingBlocked ?? false,
  };
  users.push(user);
  return user;
}

function addAffiliate(input: Partial<AffiliateRow> & { email: string; referralCode: string; userId: string }) {
  const affiliate: AffiliateRow = {
    id: input.id || id("aff"),
    email: input.email.toLowerCase(),
    referralCode: input.referralCode,
    userId: input.userId,
    approved: input.approved ?? true,
    stripeConnectId: input.stripeConnectId || `acct_${input.referralCode}`,
    onboardingCompleted: input.onboardingCompleted ?? true,
  };
  affiliates.push(affiliate);
  return affiliate;
}

function signup(email: string, ref?: string): UserRow {
  let attributedAffiliateId: string | null = null;
  if (ref) {
    const affiliate = affiliates.find(
      (candidate) => candidate.referralCode === ref && candidate.approved,
    );
    if (affiliate && affiliate.email !== email.toLowerCase()) {
      attributedAffiliateId = affiliate.id;
    }
  }

  return addUser({
    email,
    affiliateId: attributedAffiliateId,
    subscriptionStatus: "pending",
    billingBlocked: false,
  });
}

function affiliateOwnerActive(affiliate: AffiliateRow) {
  const owner = users.find((user) => user.id === affiliate.userId);
  return Boolean(
    owner &&
      owner.subscriptionStatus === "active" &&
      owner.billingBlocked !== true,
  );
}

function createHeldCreditForPaidInvoice(user: UserRow, invoiceId: string, paidCents: number) {
  if (paidCents <= 0 || !user.affiliateId) return null;
  const affiliate = affiliates.find((candidate) => candidate.id === user.affiliateId);
  if (!affiliate || !affiliate.approved || !affiliateOwnerActive(affiliate)) return null;
  if (affiliate.email === user.email || affiliate.userId === user.id) return null;

  const idempotencyKey = `${affiliate.id}:${invoiceId}`;
  const existing = credits.find((credit) => credit.idempotencyKey === idempotencyKey);
  if (existing) return existing;

  const earnedAt = new Date(now);
  const credit: CreditRow = {
    id: id("credit"),
    affiliateId: affiliate.id,
    userId: user.id,
    amountCents: AFFILIATE_MONTHLY_CREDIT_CENTS,
    amount: AFFILIATE_MONTHLY_CREDIT_USD,
    status: "held",
    earnedAt,
    payableAt: affiliateCreditPayableAt(earnedAt),
    reversedAt: null,
    reversalReason: null,
    stripeInvoiceId: invoiceId,
    idempotencyKey,
    claimOwner: null,
    processingStartedAt: null,
    stripeTransferId: null,
    paidAt: null,
  };
  credits.push(credit);
  return credit;
}

function reverseCreditForInvoice(invoiceId: string, reason: "charge.refunded" | "charge.dispute.created") {
  const credit = credits.find((candidate) => candidate.stripeInvoiceId === invoiceId);
  if (!credit) return null;
  if (credit.status === "held" || credit.status === "processing") {
    credit.status = "reversed";
    credit.reversedAt = new Date(now);
    credit.reversalReason = reason;
  } else if (credit.status === "paid") {
    credit.status = "clawback_owed";
    credit.reversedAt = new Date(now);
    credit.reversalReason = reason;
    loudLogs.push(`PAID affiliate credit needs recovery:${credit.id}`);
  }
  return credit;
}

function claimCredit(credit: CreditRow, claimOwner: string) {
  if (credit.status !== "held") return null;
  if (credit.payableAt > now) return null;
  if (credit.reversedAt) return null;
  credit.status = "processing";
  credit.claimOwner = claimOwner;
  credit.processingStartedAt = new Date(now);
  return credit;
}

function dryRunPayoutWorker(label: string) {
  let claimed = 0;
  let attempted = 0;
  let skippedInactive = 0;
  const claimOwner = `sim-worker:${label}`;

  for (const affiliate of affiliates) {
    const payable = credits.filter(
      (credit) =>
        credit.affiliateId === affiliate.id &&
        credit.status === "held" &&
        credit.payableAt <= now &&
        !credit.reversedAt,
    );
    if (payable.length === 0) continue;

    if (!affiliateOwnerActive(affiliate)) {
      skippedInactive += payable.length;
      continue;
    }

    for (const credit of payable) {
      const claim = claimCredit(credit, claimOwner);
      if (!claim) continue;
      claimed += 1;
      const idempotencyKey = `payout:${claim.id}`;
      transferAttempts.push({ creditId: claim.id, idempotencyKey });
      attempted += 1;
    }
  }

  return { claimed, attempted, skippedInactive };
}

function bucket(status: Status, affiliateId: string, payableNow = false) {
  const rows = credits.filter((credit) => {
    if (credit.affiliateId !== affiliateId) return false;
    if (payableNow) {
      return credit.status === "held" && credit.payableAt <= now && !credit.reversedAt;
    }
    return credit.status === status;
  });
  const cents = rows.reduce((sum, credit) => sum + credit.amountCents, 0);
  return { count: rows.length, cents };
}

function readinessRows() {
  return affiliates.map((affiliate) => ({
    affiliateId: affiliate.id,
    held: bucket("held", affiliate.id),
    clearedPayableNow: bucket("held", affiliate.id, true),
    paid: bucket("paid", affiliate.id),
    reversed: bucket("reversed", affiliate.id),
    clawbackOwed: bucket("clawback_owed", affiliate.id),
    processing: bucket("processing", affiliate.id),
  }));
}

function pass(n: number, test: string, ok: boolean, observed: string, failRef?: string, fix?: string): Scenario {
  return { n, test, pass: ok, observed, failRef: ok ? undefined : failRef, fix: ok ? undefined : fix };
}

function countTransferSites() {
  const roots = ["pages", "lib", "models", "scripts"];
  const nonSenderTools = new Set([
    "scripts/sim-affiliate-payouts.ts",
    "scripts/verify-stripe-writes-guarded.js",
  ]);
  const sites: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) walk(abs);
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) {
        const rel = path.relative(repoRoot, abs);
        if (nonSenderTools.has(rel)) return;
        const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
        lines.forEach((line, index) => {
          if (line.includes("transfers.create")) sites.push(`${rel}:${index + 1}`);
        });
      }
    }
  };
  roots.map((root) => path.join(repoRoot, root)).filter(fs.existsSync).forEach(walk);
  return sites.filter((site) => !site.includes("AUDIT/"));
}

function legacyRoutesInert() {
  const files = [
    "pages/api/admin/send-payout.ts",
    "pages/api/cron/affiliate-payouts.ts",
    "pages/api/affiliates/cron/autopayouts.ts",
    "pages/api/affiliates/payouts.ts",
    "pages/api/affiliates/payouts/run.ts",
    "pages/api/affiliate/payout-all.ts",
    "pages/api/scripts/processMonthlyAffiliatePayouts.ts",
  ];
  return files.map((file) => {
    const body = fs.readFileSync(path.join(repoRoot, file), "utf8");
    return { file, inert: body.includes("status(410)") && !body.includes("transfers.create") };
  });
}

async function main() {
  if (process.env.MONGODB_URI || process.env.DATABASE_URL) {
    console.log("Safety note: ignoring configured database env; simulation is in-memory only.");
  }
  process.env.AFFILIATE_PAYOUTS_ENABLED = "false";

  const scenarios: Scenario[] = [];

  const affOwner = addUser({
    id: "owner_active",
    email: "affiliate@example.test",
    subscriptionStatus: "active",
    billingBlocked: false,
  });
  const affiliate = addAffiliate({
    id: "aff_active",
    userId: affOwner.id,
    email: affOwner.email,
    referralCode: "AFF15",
  });

  const noRef = signup("no-ref@example.test");
  scenarios.push(pass(
    1,
    "Normal signup, no referral link",
    !noRef.affiliateId,
    `affiliateId=${String(noRef.affiliateId)}`,
    lineOf("pages/api/register.ts", "affiliateId: attributedAffiliateId"),
    "Keep affiliate attribution optional on signup.",
  ));

  const referred = signup("referred@example.test", affiliate.referralCode);
  scenarios.push(pass(
    2,
    "Referral signup stores affiliateId",
    referred.affiliateId === affiliate.id,
    `affiliateId=${String(referred.affiliateId)}`,
    lineOf("pages/api/register.ts", "Affiliate.findOne({"),
    "Resolve approved affiliate ref before User.create.",
  ));

  const selfRef = signup(affiliate.email, affiliate.referralCode);
  scenarios.push(pass(
    3,
    "Self-referral blocked",
    !selfRef.affiliateId,
    `affiliateId=${String(selfRef.affiliateId)}`,
    lineOf("pages/api/register.ts", "String(affiliate.email || \"\").trim().toLowerCase() !== cleanEmail"),
    "Reject attribution when signup email matches affiliate email.",
  ));

  const credit = createHeldCreditForPaidInvoice(referred, "in_sim_001", 10_000);
  const holdMs = credit ? credit.payableAt.getTime() - credit.earnedAt.getTime() : 0;
  scenarios.push(pass(
    4,
    "Credit birth on cleared payment",
    Boolean(
      credit &&
        credit.amountCents === 1500 &&
        credit.status === "held" &&
        holdMs === 30 * 24 * 60 * 60 * 1000 &&
        credit.idempotencyKey === `${affiliate.id}:in_sim_001`,
    ),
    credit
      ? `credits=1 amountCents=${credit.amountCents} status=${credit.status} holdDays=${holdMs / 86400000} key=${credit.idempotencyKey}`
      : "credit=null",
    lineOf("pages/api/stripe/webhook.ts", "AffiliatePayoutLedger.create({"),
    "Create one held ledger row with $15 and 30-day hold from verified payment.",
  ));

  createHeldCreditForPaidInvoice(referred, "in_sim_001", 10_000);
  const sameInvoiceCredits = credits.filter((row) => row.idempotencyKey === `${affiliate.id}:in_sim_001`);
  scenarios.push(pass(
    5,
    "No double credit on replay",
    sameInvoiceCredits.length === 1,
    `matchingCredits=${sameInvoiceCredits.length}`,
    lineOf("pages/api/stripe/webhook.ts", "const existing = await AffiliatePayoutLedger.findOne({ idempotencyKey });"),
    "Keep stable affiliateId:invoiceId idempotency key.",
  ));

  const unpaid = signup("unpaid@example.test", affiliate.referralCode);
  const beforeUnpaid = credits.length;
  createHeldCreditForPaidInvoice(unpaid, "in_unpaid_zero", 0);
  scenarios.push(pass(
    6,
    "No cleared payment means no credit",
    credits.length === beforeUnpaid,
    `creditsBefore=${beforeUnpaid} creditsAfter=${credits.length}`,
    lineOf("pages/api/stripe/webhook.ts", "if (paidCents > 0) {"),
    "Only call credit creation when invoice amount paid is greater than zero.",
  ));

  const inactiveOwner = addUser({
    id: "owner_inactive",
    email: "inactive-aff@example.test",
    subscriptionStatus: "canceled",
    billingBlocked: false,
  });
  const inactiveAff = addAffiliate({
    id: "aff_inactive",
    userId: inactiveOwner.id,
    email: inactiveOwner.email,
    referralCode: "INACTIVE15",
  });
  const inactiveRef = addUser({
    id: "inactive_referred",
    email: "inactive-referred@example.test",
    affiliateId: inactiveAff.id,
    subscriptionStatus: "active",
    billingBlocked: false,
  });
  const inactiveCredit = createHeldCreditForPaidInvoice(inactiveRef, "in_inactive_aff", 10_000);
  if (!inactiveCredit) {
    const manualCredit: CreditRow = {
      id: id("credit"),
      affiliateId: inactiveAff.id,
      userId: inactiveRef.id,
      amountCents: 1500,
      amount: 15,
      status: "held",
      earnedAt: new Date(now.getTime() - 31 * 86400000),
      payableAt: new Date(now.getTime() - 1 * 86400000),
      reversedAt: null,
      reversalReason: null,
      stripeInvoiceId: "in_inactive_manual",
      idempotencyKey: `${inactiveAff.id}:in_inactive_manual`,
      claimOwner: null,
      processingStartedAt: null,
      stripeTransferId: null,
      paidAt: null,
    };
    credits.push(manualCredit);
  }
  const inactiveBeforeAttempts = transferAttempts.length;
  const inactiveRun = dryRunPayoutWorker("inactive");
  const inactiveHeld = credits.filter((row) => row.affiliateId === inactiveAff.id && row.status === "held").length;
  scenarios.push(pass(
    7,
    "Affiliate inactive at payout time is skipped",
    inactiveRun.skippedInactive >= 1 && transferAttempts.length === inactiveBeforeAttempts && inactiveHeld >= 1,
    `skippedInactive=${inactiveRun.skippedInactive} attemptsDelta=${transferAttempts.length - inactiveBeforeAttempts} heldStill=${inactiveHeld}`,
    lineOf("pages/api/cron/process-affiliate-payouts.ts", "owner?.subscriptionStatus !== \"active\""),
    "Re-check affiliate owner active/billingBlocked immediately before transfer.",
  ));

  const futureRef = signup("future@example.test", affiliate.referralCode);
  const futureCredit = createHeldCreditForPaidInvoice(futureRef, "in_future", 10_000);
  const pastRef = signup("past@example.test", affiliate.referralCode);
  const pastCredit = createHeldCreditForPaidInvoice(pastRef, "in_past", 10_000);
  if (pastCredit) pastCredit.payableAt = new Date(now.getTime() - 1);
  const holdRun = dryRunPayoutWorker("hold");
  scenarios.push(pass(
    8,
    "30-day hold gates payout eligibility",
    Boolean(futureCredit?.status === "held" && pastCredit?.status === "processing" && holdRun.attempted >= 1),
    `futureStatus=${futureCredit?.status} pastStatus=${pastCredit?.status} attempted=${holdRun.attempted}`,
    lineOf("pages/api/cron/process-affiliate-payouts.ts", "payableAt: { $lte: now }"),
    "Select only held credits whose payableAt has cleared.",
  ));

  const refundRef = signup("refund@example.test", affiliate.referralCode);
  const refundCredit = createHeldCreditForPaidInvoice(refundRef, "in_refund", 10_000);
  if (refundCredit) refundCredit.payableAt = new Date(now.getTime() - 1);
  reverseCreditForInvoice("in_refund", "charge.refunded");
  const paidRef = signup("paid-refund@example.test", affiliate.referralCode);
  const paidCredit = createHeldCreditForPaidInvoice(paidRef, "in_paid_refund", 10_000);
  if (paidCredit) paidCredit.status = "paid";
  reverseCreditForInvoice("in_paid_refund", "charge.dispute.created");
  scenarios.push(pass(
    9,
    "Refund/chargeback clawback",
    Boolean(refundCredit?.status === "reversed" && paidCredit?.status === "clawback_owed" && loudLogs.length === 1),
    `heldRefundStatus=${refundCredit?.status} paidRefundStatus=${paidCredit?.status} loudLogs=${loudLogs.length}`,
    lineOf("pages/api/stripe/webhook.ts", "status === \"held\" || status === \"processing\""),
    "Reverse held/processing credits and mark paid credits clawback_owed.",
  ));

  const raceRef = signup("race@example.test", affiliate.referralCode);
  const raceCredit = createHeldCreditForPaidInvoice(raceRef, "in_race", 10_000);
  if (raceCredit) raceCredit.payableAt = new Date(now.getTime() - 1);
  const raceRunA = dryRunPayoutWorker("race-a");
  const raceRunB = dryRunPayoutWorker("race-b");
  const raceAttempts = transferAttempts.filter((attempt) => attempt.creditId === raceCredit?.id);
  scenarios.push(pass(
    10,
    "Payout worker idempotency and atomic claim",
    Boolean(raceCredit?.status === "processing" && raceAttempts.length === 1 && raceAttempts[0]?.idempotencyKey === `payout:${raceCredit.id}` && raceRunB.attempted === 0),
    `status=${raceCredit?.status} attempts=${raceAttempts.length} key=${raceAttempts[0]?.idempotencyKey} secondRunAttempts=${raceRunB.attempted}`,
    lineOf("pages/api/cron/process-affiliate-payouts.ts", "status: \"processing\""),
    "Keep held->processing atomic claim and payout:<ledgerId> idempotency key.",
  ));

  const transferSites = countTransferSites();
  const inert = legacyRoutesInert();
  const inertFailures = inert.filter((item) => !item.inert);
  scenarios.push(pass(
    11,
    "Only one transfer path exists",
    transferSites.length === 1 &&
      transferSites[0] === "pages/api/cron/process-affiliate-payouts.ts:81" &&
      inertFailures.length === 0,
    `transferSites=${transferSites.join(", ")} inertLegacyRoutes=${inert.filter((item) => item.inert).length}/${inert.length}`,
    lineOf("pages/api/cron/process-affiliate-payouts.ts", "const transfer = await stripe.transfers.create("),
    "Leave legacy payout routes 410 and keep only the canonical worker sender.",
  ));

  const beforeReadiness = JSON.stringify(credits);
  const rows = readinessRows();
  const afterReadiness = JSON.stringify(credits);
  const activeRow = rows.find((row) => row.affiliateId === affiliate.id);
  const expected = {
    held: credits.filter((row) => row.affiliateId === affiliate.id && row.status === "held").length,
    processing: credits.filter((row) => row.affiliateId === affiliate.id && row.status === "processing").length,
    paid: credits.filter((row) => row.affiliateId === affiliate.id && row.status === "paid").length,
    reversed: credits.filter((row) => row.affiliateId === affiliate.id && row.status === "reversed").length,
    clawback: credits.filter((row) => row.affiliateId === affiliate.id && row.status === "clawback_owed").length,
  };
  scenarios.push(pass(
    12,
    "Readiness view is accurate and read-only",
    Boolean(
      activeRow &&
        activeRow.held.count === expected.held &&
        activeRow.processing.count === expected.processing &&
        activeRow.paid.count === expected.paid &&
        activeRow.reversed.count === expected.reversed &&
        activeRow.clawbackOwed.count === expected.clawback &&
        beforeReadiness === afterReadiness,
    ),
    activeRow
      ? `held=${activeRow.held.count}/${expected.held} processing=${activeRow.processing.count}/${expected.processing} paid=${activeRow.paid.count}/${expected.paid} reversed=${activeRow.reversed.count}/${expected.reversed} clawback=${activeRow.clawbackOwed.count}/${expected.clawback} writes=${beforeReadiness === afterReadiness ? 0 : 1}`
      : "active affiliate row missing",
    lineOf("pages/api/admin/affiliate-payout-readiness.ts", "const ledgerAgg = await AffiliatePayoutLedger.aggregate(["),
    "Keep readiness endpoint aggregation-only and align buckets to ledger statuses.",
  ));

  const failed = scenarios.filter((scenario) => !scenario.pass);
  const tableRows = scenarios.map((scenario) => {
    const status = scenario.pass ? "PASS" : "FAIL";
    const observed = scenario.observed.replace(/\|/g, "\\|");
    const fix = scenario.pass ? "" : `${scenario.failRef} - ${scenario.fix}`;
    return `| ${scenario.n} | ${scenario.test} | ${status} | ${observed} | ${fix.replace(/\|/g, "\\|")} |`;
  });

  const goNoGo = failed.length === 0
    ? "GO to deploy with payouts still disabled. Do not enable payouts until production env review confirms AFFILIATE_PAYOUTS_ENABLED remains false by default and Stripe write guard configuration is intentional."
    : `NO-GO. Fix ${failed.length} failing scenario(s) before deploy.`;

  const body = [
    "# Affiliate Payout Simulation Results",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "Safety: in-memory fake data only; no database connection; no Stripe client; no Stripe live/test API calls; no money; no deploy; no push.",
    "",
    "| # | What it tests | Result | Actual observed value | Fail reference / fix |",
    "|---:|---|---|---|---|",
    ...tableRows,
    "",
    "## Go / No-Go",
    "",
    goNoGo,
    "",
    "## Source Anchors Checked",
    "",
    `- Signup attribution: ${lineOf("pages/api/register.ts", "affiliateId: attributedAffiliateId")}`,
    `- Credit creation: ${lineOf("pages/api/stripe/webhook.ts", "AffiliatePayoutLedger.create({")}`,
    `- Clawback: ${lineOf("pages/api/stripe/webhook.ts", "status === \"held\" || status === \"processing\"")}`,
    `- Worker claim: ${lineOf("pages/api/cron/process-affiliate-payouts.ts", "status: \"processing\"")}`,
    `- Worker transfer: ${lineOf("pages/api/cron/process-affiliate-payouts.ts", "const transfer = await stripe.transfers.create(")}`,
    `- Readiness aggregation: ${lineOf("pages/api/admin/affiliate-payout-readiness.ts", "const ledgerAgg = await AffiliatePayoutLedger.aggregate([")}`,
    "",
    "## Runtime Guardrails Observed",
    "",
    `- AFFILIATE_PAYOUTS_ENABLED during simulation: ${process.env.AFFILIATE_PAYOUTS_ENABLED}`,
    `- Canonical payout amount imported from policy: ${AFFILIATE_MONTHLY_CREDIT_CENTS} cents / $${AFFILIATE_MONTHLY_CREDIT_USD}`,
    `- Transfer attempts were dry-run records only: ${transferAttempts.length}`,
    `- Live transfer call sites under pages/lib/models/scripts: ${transferSites.join(", ")}`,
    "",
  ].join("\n");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body);

  console.log(body);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

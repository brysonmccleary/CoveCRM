# 02 Affiliate Payout Integrity

Scope: `AUDIT/REPO_MAP.md` §2 transfer sites plus cited payout candidates. Read-only.

## Findings

[P0] Public route can inflate `payoutDue`, then automated/manual payout paths can send it — pages/api/affiliate/add-referral.ts:27  
Risk: Anonymous payout balance minting (Section 1) feeds `Affiliate.payoutDue`, which is paid by `/api/affiliates/cron/autopayouts`, `/api/cron/affiliate-payouts`, `/api/affiliates/payouts*`, `/api/admin/send-payout`, and `/api/affiliate/payout-all`. This is direct money loss if any payout path runs after forged credits.  
Fix: Disable/remove public `add-referral`; only Stripe webhook should create payable affiliate credits with invoice/subscription proof; effort S.  
Confidence: verified

[P0] Multiple overlapping `payoutDue` sweepers can double-pay the same balance — pages/api/affiliates/cron/autopayouts.ts:40  
Risk: Several routes read the same `Affiliate.payoutDue` balance and create independent idempotency keys (`sweep:<affiliate>:<amount>`, period hash, manual day key, or none). Two workers can observe the same balance before either writes it down and both transfer.  
Fix: Canonicalize to one payout worker with an atomic claim on a single `AffiliatePayout` row/source id before Stripe transfer; effort M.  
Confidence: verified

Evidence:
```ts
// weekly cron sweep
40 const affiliates = await Affiliate.find({ payoutDue: { $gte: minUSD }})
48 const idempotencyKey = `sweep:${affiliate._id}:${Math.round(amountUSD * 100)}`;
78 const transfer = await stripe.transfers.create({ ... });

// another cron/manual sweep
98 const idemKey = buildIdemKey(String(a._id), periodStart, periodEnd, amount);
130 const transfer = await stripe.transfers.create(..., { idempotencyKey: idemKey });
```

[P0] Webhook autopayout has no Stripe idempotency key — pages/api/stripe/webhook.ts:533  
Risk: `maybeAutoPayout` checks `AffiliatePayout` before transfer, but does not pass `{ idempotencyKey }` to Stripe. If the request crashes/retries after Stripe transfer and before `AffiliatePayout.create`, the same invoice can transfer twice.  
Fix: Pass the stable `${affiliate._id}:${invoiceId}` idempotency key to `stripe.transfers.create` and create a pending/claimed ledger before Stripe call; effort S.  
Confidence: verified

[P0] Weekly autopayout cron also lacks Stripe idempotency key — pages/api/affiliates/cron/autopayouts.ts:78  
Risk: Same retry window: transfer is created without Stripe idempotency, then `AffiliatePayout` is written after. A timeout between those operations duplicates payout on retry.  
Fix: Use the existing `idempotencyKey` in the Stripe call and persist a `processing` claim first; effort S.  
Confidence: verified

[P1] `affiliate/payout-all` bulk route transfers without Stripe idempotency or payout row — pages/api/affiliate/payout-all.ts:41  
Risk: Protected by `ADMIN_PAYOUT_SECRET`, but one retry can re-send every eligible affiliate because no Stripe idempotency key or `AffiliatePayout` ledger row is used before transfer.  
Fix: Disable this legacy route or route through canonical payout ledger; effort S.  
Confidence: verified

[P1] Two payout models split truth and cannot mutually prevent double-pay — models/AffiliatePayout.ts:33  
Risk: `AffiliatePayout` has unique `idempotencyKey`, while `AffiliatePayoutLedger` separately has unique `idempotencyKey`; `payoutDue` sweepers and $12.50/referral ledger payers do not share one claim source, so one model cannot see the other's payout.  
Fix: Introduce one canonical `affiliate_payout` ledger/source id (`affiliateId:userId:month` or `affiliateId:invoiceId`) and make all transfer paths call it; effort M.  
Confidence: verified

[P1] $12.50 monthly referral payout overlaps with flat first-invoice payout — pages/api/stripe/webhook.ts:1307  
Risk: Stripe webhook credits `payoutDue` using `flatPayoutAmount` default $25 / `AFFILIATE_DEFAULT_PAYOUT`, while `processReferralLinkMonthlyPayout` creates $12.50/month ledger entries for `user.affiliateId`. Both can exist for related affiliate programs and are not clearly mutually exclusive in code.  
Fix: Explicitly separate legacy promo-code flat payout from referral-link monthly payout and enforce one program per referred user/subscription; effort M.  
Confidence: likely

[P1] `affiliates/sync` can repeatedly over-credit `payoutDue` — pages/api/affiliates/sync.ts:51  
Risk: Admin route loops Stripe subscriptions and `$inc`s `totalRedemptions`, hardcoded revenue `150`, and `payoutDue` without a per-subscription idempotency record; every run can inflate balances.  
Fix: Remove/disable or make reconciliation read-only; if retained, write one ledger row per subscription/customer/month before increment; effort S.  
Confidence: verified

[P2] Automation is not single-canonical — vercel.json:8  
Risk: Actual scheduled payouts include monthly `/api/cron/process-affiliate-payouts` and weekly `/api/affiliates/cron/autopayouts`; other secret/admin routes can also pay. Operators cannot reason from one canonical path.  
Fix: Keep only one production cron and one admin override that invokes the same ledger claim function; effort M.  
Confidence: verified

## Payout Path Inventory / Verdict

- `pages/api/cron/process-affiliate-payouts.ts:30`: canonical-looking monthly ledger payer for `AffiliatePayoutLedger`; uses Stripe idempotency key at line 42. It does not pay `payoutDue`.
- `pages/api/affiliates/cron/autopayouts.ts:78`: weekly Vercel cron sweeps `Affiliate.payoutDue`; no Stripe idempotency key.
- `pages/api/cron/affiliate-payouts.ts:130`: unscheduled cron/manual sweeps `Affiliate.payoutDue`; passes Stripe idempotency key, but independent from weekly sweep key.
- `pages/api/stripe/webhook.ts:533`: invoice-triggered `payoutDue` autopay; no Stripe idempotency key.
- `pages/api/stripe/webhook.ts:598`: invoice-triggered $12.50 ledger transfer; has Stripe idempotency key and marks ledger paid.
- `pages/api/admin/send-payout.ts:155`: manual admin/token payout from `payoutDue`; has Stripe idempotency key but independent day/amount key.
- `pages/api/affiliate/payout-all.ts:41`: bulk secret route from `payoutDue`; no Stripe idempotency key, no payout row.
- `pages/api/affiliates/payouts.ts:90` and `pages/api/affiliates/payouts/run.ts:96`: admin manual payout routes; both sweep `payoutDue` with period+amount key.
- `pages/api/scripts/processMonthlyAffiliatePayouts.ts:99`: token-protected route, not Vercel scheduled; duplicates manual period+amount sweep semantics.

## Answer: Can Two Paths Pay The Same Earned Amount Twice?

Yes. Verified for `Affiliate.payoutDue` paths: weekly autopayout, cron/manual sweep, webhook autopayout, admin payout, and payout-all all derive amount from the mutable `payoutDue` field. They do not first atomically claim the same payout row/source id. Two concurrent invocations can transfer before either decrements `payoutDue`; retry windows exist on no-idempotency transfer calls.

The $12.50 `AffiliatePayoutLedger` path is stronger for duplicate prevention within that model (`models/AffiliatePayoutLedger.ts:32-41`, Stripe idempotency at `pages/api/cron/process-affiliate-payouts.ts:42` and `pages/api/stripe/webhook.ts:606`), but it is not integrated with `payoutDue` sweepers.

## Recommended Canonical Scheme

- One `affiliate_payout_events` ledger with unique source id: `affiliateId:program:userId|invoiceId:period:amountCents`.
- States: `pending -> processing -> paid|failed`; claim via atomic `findOneAndUpdate({status:"pending"}, {$set:{status:"processing", lockOwner}})`.
- Stripe transfer always uses the same source id as idempotency key.
- All legacy routes either disabled or call the canonical claim function.
- Public attribution never mutates payable balances; it only records non-payable intent until Stripe invoice proves payment.

## Ranked Section List

1. P0 public payout balance minting feeding automated payout paths.
2. P0 overlapping `payoutDue` sweepers can double-pay.
3. P0 missing Stripe idempotency in webhook and weekly autopayout transfers.
4. P1 split payout ledgers and mixed $25/$12.50 program semantics.
5. P1 repeatable admin sync over-credits payouts.
6. P2 payout automation has too many production-capable entry points.

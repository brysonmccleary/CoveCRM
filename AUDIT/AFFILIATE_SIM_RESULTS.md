# Affiliate Payout Simulation Results

Generated: 2026-07-02T18:55:46.037Z

Safety: in-memory fake data only; no database connection; no Stripe client; no Stripe live/test API calls; no money; no deploy; no push.

| # | What it tests | Result | Actual observed value | Fail reference / fix |
|---:|---|---|---|---|
| 1 | Normal signup, no referral link | PASS | affiliateId=null |  |
| 2 | Referral signup stores affiliateId | PASS | affiliateId=aff_active |  |
| 3 | Self-referral blocked | PASS | affiliateId=null |  |
| 4 | Credit birth on cleared payment | PASS | credits=1 amountCents=1500 status=held holdDays=30 key=aff_active:in_sim_001 |  |
| 5 | No double credit on replay | PASS | matchingCredits=1 |  |
| 6 | No cleared payment means no credit | PASS | creditsBefore=1 creditsAfter=1 |  |
| 7 | Affiliate inactive at payout time is skipped | PASS | skippedInactive=1 attemptsDelta=0 heldStill=1 |  |
| 8 | 30-day hold gates payout eligibility | PASS | futureStatus=held pastStatus=processing attempted=1 |  |
| 9 | Refund/chargeback clawback | PASS | heldRefundStatus=reversed paidRefundStatus=clawback_owed loudLogs=1 |  |
| 10 | Payout worker idempotency and atomic claim | PASS | status=processing attempts=1 key=payout:credit_0016 secondRunAttempts=0 |  |
| 11 | Only one transfer path exists | PASS | transferSites=pages/api/cron/process-affiliate-payouts.ts:81 inertLegacyRoutes=7/7 |  |
| 12 | Readiness view is accurate and read-only | PASS | held=2/2 processing=2/2 paid=0/0 reversed=1/1 clawback=1/1 writes=0 |  |

## Go / No-Go

GO to deploy with payouts still disabled. Do not enable payouts until production env review confirms AFFILIATE_PAYOUTS_ENABLED remains false by default and Stripe write guard configuration is intentional.

## Source Anchors Checked

- Signup attribution: pages/api/register.ts:263
- Credit creation: pages/api/stripe/webhook.ts:544
- Clawback: pages/api/stripe/webhook.ts:667
- Worker claim: pages/api/cron/process-affiliate-payouts.ts:67
- Worker transfer: pages/api/cron/process-affiliate-payouts.ts:81
- Readiness aggregation: pages/api/admin/affiliate-payout-readiness.ts:100

## Runtime Guardrails Observed

- AFFILIATE_PAYOUTS_ENABLED during simulation: false
- Canonical payout amount imported from policy: 1500 cents / $15
- Transfer attempts were dry-run records only: 2
- Live transfer call sites under pages/lib/models/scripts: pages/api/cron/process-affiliate-payouts.ts:81

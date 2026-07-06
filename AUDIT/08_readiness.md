# 08 Production Readiness Notes

Static audit only. No external systems were exercised.

## Readiness Blockers

| rank | blocker | evidence |
|---|---|---|
| P0 | Public affiliate routes can mint or expose payout state. This is the most direct money-integrity blocker. | `pages/api/affiliate/add-referral.ts:13`; `pages/api/affiliate-track.ts:10`; `pages/api/affiliates/all.ts:20`; see `AUDIT/01_security.md` and `AUDIT/02_payouts.md`. |
| P0 | Multiple payout sweepers can transfer from the same `Affiliate.payoutDue` balance, with some transfer paths lacking Stripe idempotency keys. | `pages/api/affiliates/cron/autopayouts.ts:78`; `pages/api/stripe/webhook.ts:533`; `pages/api/affiliate/payout-all.ts:41`; see `AUDIT/02_payouts.md`. |
| P0 | Unauthenticated admin numbers endpoint exposes all tenants' phone/billing data. | `pages/api/admin/numbers.ts:24`; `pages/api/admin/numbers.ts:44`; see `AUDIT/01_security.md`. |
| P1 | Several webhook-style Twilio/Meta endpoints either skip signatures or rely on shared query/header tokens. | `pages/api/ai-calls/call-status-webhook.ts:181`; `pages/api/ai-calls/recording-webhook.ts:27`; `pages/api/twilio/voice-status.ts:1`; `pages/api/meta/webhook.ts:26`. |
| P1 | Billing idempotency is strong for normal usage and AI session usage, but stuck `BillingEvent` rows in `charging` need operational visibility. | `lib/billing/trackUsage.ts:230`; see `AUDIT/03_billing_usage.md`. |
| P1 | AI transfer metering should be verified against production call logs for successful transfers and reboot/fallback transfers. | `ai-voice-server/index.ts:11270`; `ai-voice-server/index.ts:10966`; `pages/api/ai-calls/transfer-reboot-twiml.ts:41`. |

## Biggest Operational Checks Before Launch

| check | reason |
|---|---|
| Reconcile Stripe Transfers for all transfer sites against Affiliate/AffiliatePayout/AffiliatePayoutLedger rows. | Confirms no double-payout from mixed ledgers. |
| Query for `BillingEvent.status = "charging"` older than lock TTL. | Confirms threshold billing has no silent stuck charges. |
| Compare Twilio call logs for live-transfer sessions by lead CallSid, agent CallSid, and conference name. | Confirms no unexpected double-leg or lingering stream cost. |
| Confirm production env has `META_APP_SECRET`, `STRIPE_WEBHOOK_SECRET`, Twilio auth tokens, and high-entropy internal tokens. | Signature paths are env-dependent in several endpoints. |
| Confirm cron overlap and disable duplicate payout crons/routes until one payout ledger is canonical. | `vercel.json` schedules weekly `cron/affiliate-payouts`; other payout routes remain callable by secret/session. |

## Lower-Risk Notes

| note | evidence |
|---|---|
| Main AI call start and worker paths enforce billing readiness before paid calling. | `pages/api/ai-calls/start.ts:348`; `pages/api/ai-calls/worker.ts:561`. |
| Sheets webhook is HMAC and token-hash gated, not an unauthenticated public write. | `pages/api/sheets/webhook.ts:407`; `pages/api/sheets/webhook.ts:532`. |
| Stripe webhook verifies Stripe signature. | `pages/api/stripe/webhook.ts:712`; `pages/api/stripe/webhook.ts:720`. |
| Voice recording webhook verifies Twilio signatures across platform/personal tokens. | `pages/api/voice/recording-webhook.ts:116`; `pages/api/voice/recording-webhook.ts:148`. |


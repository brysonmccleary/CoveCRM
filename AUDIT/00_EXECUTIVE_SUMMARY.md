# 00 Executive Summary

Static, read-only production audit. No app server, DB, Stripe, Twilio, OpenAI, migrations, installs, commits, or non-audit writes were executed. Primary map: `AUDIT/REPO_MAP.md`.

## P0/P1 Ranked Findings

| rank | area | finding | primary evidence | report |
|---|---|---|---|---|
| P0 | Affiliate money | Public endpoint can mint affiliate payout balance from client-supplied `promoCode/referredEmail/amountPaid`. | `pages/api/affiliate/add-referral.ts:13`; `pages/api/affiliate/add-referral.ts:31` | `AUDIT/01_security.md`, `AUDIT/02_payouts.md` |
| P0 | Affiliate identity | Public affiliate attribution can mark arbitrary users as referred. | `pages/api/affiliate-track.ts:10`; `pages/api/affiliate-track.ts:23` | `AUDIT/01_security.md` |
| P0 | Affiliate onboarding | Public affiliate Connect onboarding/registration is email/body driven and can create or steer payout setup. | `pages/api/affiliates/onboard.ts:19`; `pages/api/affiliates/register.ts:15` | `AUDIT/01_security.md` |
| P0 | Payouts | Multiple overlapping `payoutDue` sweepers can pay the same balance; several transfer paths lack Stripe idempotency. | `pages/api/affiliates/cron/autopayouts.ts:78`; `pages/api/stripe/webhook.ts:533`; `pages/api/affiliate/payout-all.ts:41` | `AUDIT/02_payouts.md` |
| P0 | Data exposure | `admin/numbers` exposes all tenant phone/billing data without auth. | `pages/api/admin/numbers.ts:24`; `pages/api/admin/numbers.ts:44` | `AUDIT/01_security.md` |
| P1 | Webhooks | AI call status/recording and manual voice status callbacks write state without Twilio signature verification. | `pages/api/ai-calls/call-status-webhook.ts:181`; `pages/api/ai-calls/recording-webhook.ts:27`; `pages/api/twilio/voice-status.ts:1` | `AUDIT/01_security.md` |
| P1 | Meta webhook | Meta webhook can skip signature enforcement when env/header is missing. | `pages/api/meta/webhook.ts:26`; `pages/api/meta/webhook.ts:73` | `AUDIT/01_security.md` |
| P1 | Affiliate privacy | Public affiliate summary exposes affiliate emails and payout balances. | `pages/api/affiliates/all.ts:20`; `pages/api/affiliates/all.ts:63` | `AUDIT/01_security.md` |
| P1 | Affiliate accounting | Two payout models split source of truth and overlap flat/monthly referral payouts. | `models/AffiliatePayout.ts:33`; `models/AffiliatePayoutLedger.ts:25`; `models/Affiliate.ts:128`; `models/Affiliate.ts:135` | `AUDIT/02_payouts.md` |
| P1 | Billing ops | Usage idempotency is strong, but `BillingEvent.status = "charging"` can remain stuck without an operational recovery path. | `lib/billing/trackUsage.ts:230` | `AUDIT/03_billing_usage.md` |
| P1 | Voice costs | Live transfer closes OpenAI on redirect but final meter depends on Twilio stream stop/close; verify no delayed tail cost. | `ai-voice-server/index.ts:11270`; `ai-voice-server/index.ts:10966` | `AUDIT/04_voice_transfer.md`, `AUDIT/06_openai_cogs.md` |
| P1 | Twilio costs | Live transfer and mobile inbound create concurrent call legs/conferences; dashboard cost must be reconciled by CallSid/conference. | `pages/api/ai-calls/transfer-twiml.ts:137`; `pages/api/twilio/voice/inbound.ts:455` | `AUDIT/05_twilio_costs.md` |
| P1 | Signup/trial | Subscription/card endpoints are partially body-email driven; card/customer checks reduce direct takeover risk, but session-only would be stronger. | `pages/api/create-subscription.ts:121`; `pages/api/stripe/set-default-payment-method.ts:16`; `pages/api/stripe/set-default-payment-method.ts:54` | `AUDIT/07_signup_trial.md` |

## Biggest Wins

1. Make affiliate/payout money paths canonical: disable or gate public affiliate write routes, choose one payout ledger, and ensure every `transfers.create` uses a Stripe idempotency key tied to a durable payout row.
2. Close unauthenticated high-impact reads/writes first: `admin/numbers`, affiliate public summaries, AI call status/recording callbacks, and Meta signature fail-open behavior.
3. Add operational monitors for money invariants: old `BillingEvent.status = "charging"`, duplicate payout keys, nonzero `payoutDue` after transfer, and transfer sessions with abnormal Twilio/OpenAI duration tails.
4. Reconcile voice economics from logs: AI live transfer should be checked by lead CallSid, agent CallSid, conference name, Twilio stream stop time, and AI session billed seconds.

## Files Produced

| file | purpose |
|---|---|
| `AUDIT/REPO_MAP.md` | Full API route/money/webhook/cron/voice/env/candidate inventory. |
| `AUDIT/01_security.md` | Auth, webhook, ownership, and public write/read risks. |
| `AUDIT/02_payouts.md` | Stripe transfer sites, affiliate payout double-pay analysis, payout ledgers. |
| `AUDIT/03_billing_usage.md` | `BillingEvent`, `trackUsage`, AI dialer metering, idempotency. |
| `AUDIT/04_voice_transfer.md` | Live transfer, conference bridge, OpenAI websocket lifecycle, transcript/billing points. |
| `AUDIT/05_twilio_costs.md` | Twilio leg/conference cost model from code. |
| `AUDIT/06_openai_cogs.md` | Realtime model/config and OpenAI COGS formula. |
| `AUDIT/07_signup_trial.md` | Signup, email verification, card-gated trial activation. |
| `AUDIT/08_readiness.md` | Launch blockers and operational checks. |


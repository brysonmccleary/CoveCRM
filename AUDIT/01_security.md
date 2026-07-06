# 01 Security & Auth

Scope: map-driven review of `AUDIT/REPO_MAP.md` CANDIDATES and the sharp Section 1 endpoints. Read-only; no runtime/prod env verification.

## Findings

[P0] Public endpoint can mint affiliate payout balance — pages/api/affiliate/add-referral.ts:13  
Risk: Anonymous POST controls `promoCode`, `referredEmail`, and `amountPaid`; if `promoCode` exists, the route increments `totalRedemptions`, `totalRevenueGenerated`, and `payoutDue` without session, webhook signature, or Stripe invoice proof.  
Fix: Remove this route from public use or require Stripe-webhook-only attribution with a stable invoice/subscription idempotency key; effort S.  
Confidence: verified

Proof:
```ts
13 const { promoCode, referredEmail, amountPaid = 0 } = req.body;
20 const affiliate = await Affiliate.findOne({ promoCode: promoCode.toUpperCase() });
27 affiliate.totalRedemptions += 1;
28 affiliate.totalRevenueGenerated += amountPaid;
29 affiliate.payoutDue += affiliate.flatPayoutAmount;
31 await affiliate.save();
```

[P0] Public affiliate attribution route lets attacker mark arbitrary users referred — pages/api/affiliate-track.ts:10  
Risk: Anonymous POST can set `referredBy` and `referralDiscountApplied` on any `User` by email; this can corrupt attribution and feed payout/revenue logic if legacy fields are still consumed.  
Fix: Require an authenticated session matching the target email or move attribution exclusively into signup/Stripe webhook flow; effort S.  
Confidence: verified

[P0] Public affiliate Connect onboarding by email can create/control payout destination setup — pages/api/affiliates/onboard.ts:19  
Risk: Anonymous caller supplies any affiliate email; if the affiliate lacks `stripeConnectId`, the route creates a Stripe Express account and returns an onboarding link for that affiliate record. This can redirect payout setup for someone else.  
Fix: Require session ownership of the affiliate record, or admin-only action; effort S.  
Confidence: verified

[P0] Public affiliate registration creates Stripe Connect account and affiliate row — pages/api/affiliates/register.ts:15  
Risk: Anonymous POST creates `Affiliate` records and Stripe Connect accounts from request-body identity fields. `payoutDue` starts at 0, so this is not direct theft alone, but it is an unguarded payout-surface/account-creation spam vector.  
Fix: Require signed-in user ownership and rate limiting; only admin/webhook should approve payable affiliates; effort S.  
Confidence: verified

[P1] Public affiliate confirm updates verified payout status by email — pages/api/affiliates/confirm.ts:12  
Risk: Anonymous GET with `email` retrieves that affiliate's Stripe account and marks `onboardingCompleted=true` / `connectedAccountStatus=verified` if Stripe reports details submitted. It cannot pick a new destination by itself, but it can flip payout readiness for arbitrary affiliates.  
Fix: Require session ownership or signed Stripe account-link return state; effort S.  
Confidence: verified

[P1] Meta lead webhook accepts unsigned POSTs when app secret/header is missing — pages/api/meta/webhook.ts:26  
Risk: `validateSignature` returns true if `META_APP_SECRET` is unset, and missing signature headers are allowed even when `META_APP_SECRET` exists. A forged POST can drive `processMetaLead` and create/import leads if payload ids resolve. Current prod env config not verified.  
Fix: Fail closed in production when `META_APP_SECRET` or `x-hub-signature-256` is missing; keep dashboard-test bypass behind a separate admin-only route; effort S.  
Confidence: verified code, needs-runtime-check env

[P2] Deprecated Facebook webhook also fails open if `FB_APP_SECRET` is unset — pages/api/facebook/webhook.ts:35  
Risk: Signature validation returns true without `FB_APP_SECRET`; current handler is deprecated and returns before processing leads at lines 145-149, so impact appears low unless old code is restored.  
Fix: Fail closed for POST when secret is missing; effort S.  
Confidence: verified

[P1] AI call status webhook writes outcomes without Twilio signature — pages/api/ai-calls/call-status-webhook.ts:181  
Risk: Forged POST can upsert `AICallRecording` by `CallSid`, set terminal status/duration/AMD fields, and kick the AI worker using server-side secrets. This can corrupt AI call outcomes, fast-skip state, and worker progression.  
Fix: Validate `x-twilio-signature` against platform/user token or require a private callback token in the status URL; effort M.  
Confidence: verified

[P1] AI recording webhook writes recording metadata without Twilio signature — pages/api/ai-calls/recording-webhook.ts:27  
Risk: Forged POST can create/update `AICallRecording` with attacker-supplied `RecordingUrl`, duration, sessionId, and leadId, causing wrong transcripts/recording association.  
Fix: Validate Twilio signature or a per-session callback token before writes; effort M.  
Confidence: verified

[P1] Manual voice-status callback has no inbound auth and can affect billing/outcomes — pages/api/twilio/voice-status.ts:1  
Risk: Map flagged no signature and code shows no request validation before billing/finalization logic; forged statuses can update `Call` state and interact with usage billing/finalization paths.  
Fix: Use raw body and Twilio signature validation like `status-callback.ts`, with per-user token fallback if needed; effort M.  
Confidence: verified

[P2] Google Calendar webhook trusts resource/channel headers only — pages/api/calendar/webhook.ts:46  
Risk: Forged POST with a known `x-goog-resource-id` can cause the server to fetch events and create CRM leads for that user's calendar. It does scope by stored resource id and user tokens, but lacks Google channel token verification.  
Fix: Store and verify `x-goog-channel-token` per watch; effort M.  
Confidence: verified

[P0] Admin numbers endpoint exposes tenant phone/billing data without auth — pages/api/admin/numbers.ts:24  
Risk: Anonymous GET enumerates every user's phone numbers, usage counters, and Stripe subscription status/next billing date.  
Fix: Require admin session or internal secret; effort S.  
Confidence: verified

[P1] Public affiliate summary leaks payout balances — pages/api/affiliates/all.ts:20  
Risk: Anonymous GET returns affiliate names/emails/promo codes, redemptions, revenue, and `payoutDue` for all affiliates.  
Fix: Require admin session or return only public-safe fields; effort S.  
Confidence: verified

[P1] Admin affiliate sync can inflate payoutDue from Stripe coupons — pages/api/affiliates/sync.ts:51  
Risk: Admin-only route increments `totalRedemptions`, hardcoded `totalRevenueGenerated: 150`, and `payoutDue` for active Stripe subs without a shared idempotency key. A repeat run can over-credit affiliates.  
Fix: Remove or make read-only; if retained, use invoice/subscription idempotency ledger; effort S.  
Confidence: verified

[P2] Shared-secret comparisons are plain equality and some secrets travel in query strings — pages/api/ai-calls/transfer-twiml.ts:72  
Risk: Many internal routes compare `key !== AI_DIALER_CRON_KEY` / bearer strings directly and put keys into TwiML URLs; this is not constant-time and query secrets can land in logs. Impact depends on secret entropy and log access.  
Fix: Use `timingSafeEqual` helper and prefer headers/body server-to-server; avoid query keys where Twilio does not require them; effort M.  
Confidence: verified

[P2] Rate limiting not evident on password reset/OTP/SMS-sensitive public endpoints — pages/api/auth/request-password-reset.ts:32  
Risk: Map candidates include unauthenticated password reset, OTP, SMS opt-in/send paths; sampled code paths did not show a shared limiter. SMS pumping and email/OTP abuse remain likely.  
Fix: Add per-IP and per-identity limiter plus abuse logging on auth reset, OTP, and SMS-send routes; effort M.  
Confidence: likely

## False Positives / Lower Risk Adjudications

- `pages/api/admin/audit-sheets.ts:12` is not NONE: it requires `x-admin-secret` matching `ADMIN_SECRET`.
- `pages/api/sheets/webhook.ts:406-423` verifies an HMAC, and `pages/api/sheets/webhook.ts:532-563` checks the token hash against the stored connection. The map's "NO obvious signature" is false.
- `pages/api/leads/by-phone.ts:41-46` scopes lookup by `userEmail`/owner fields, but it trusts `COVECRM_API_SECRET` plus client-supplied `userEmail`. It is not anonymous IDOR; it is a shared-secret/identity-binding risk.
- `pages/api/messages/mark-read.ts:17-28` and `pages/api/mobile/message/mark-read.ts:16-43` are owner-scoped by session/JWT email.
- `pages/api/admin/affiliate-stats.ts:17-21` and `pages/api/admin/meta-diagnostics.ts:17-19` are admin/session gated; broad reads are intended admin diagnostics.
- `pages/api/twilio/inbound-sms.ts:1517-1538` has a server-only `INTERNAL_API_TOKEN` bypass, but direct equality is used and the bypass logs only generic status. It is acceptable only if the token is high entropy and never client-exposed; env not verified.
- Server-side paid-action blocking is present for AI calls at `pages/api/ai-calls/start.ts:348-350` and worker progression at `pages/api/ai-calls/worker.ts:561-580`. SMS/number-purchase enforcement needs fuller per-route review.
- Admin billing bypass uses session/admin lists in sampled billing code (`lib/billing/trackUsage.ts:30-39`, `lib/billing/checkCallingAllowed.ts:18-34`). I did not find a sampled path where a request-body email alone grants admin free billing, but a few internal agent routes take shared-secret identity and should be kept server-only.

## Ranked Section List

1. P0 public payout balance minting in `affiliate/add-referral`.
2. P0 public affiliate onboarding can create/control Connect onboarding link by email.
3. P0 unauthenticated `admin/numbers` tenant phone/billing exposure.
4. P1 unsigned Twilio AI/manual status and recording webhooks corrupt call outcomes/billing metadata.
5. P1 Meta webhook fail-open if prod app secret/signature is absent.
6. P1 public affiliate summaries and repeatable affiliate sync can leak/inflate payout data.
7. P2 shared-secret/query-secret hygiene and rate limiting gaps.

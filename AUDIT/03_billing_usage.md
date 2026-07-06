# 03 Billing & Usage Invariant Verification

Scope: charge-side invariants only. This does not redesign billing; it verifies caller identity and idempotency from code.

## Findings

[P1] Billing events stuck in `charging` require manual discovery — lib/billing/trackUsage.ts:230  
Risk: The charge side correctly fails closed when a prior event is `charging`, but the only signal is a log; an unresolved event can stall that source/customer's billing until someone notices.  
Fix: Add read-only reconciliation/alert job for `BillingEvent` rows in `charging`, `stripe_created`, or repeated `failed` older than N minutes; effort S.  
Confidence: verified

[P2] `trackUsage` eligibility guard depends on resolvable `user.email`, but sampled callers satisfy it — lib/billing/trackUsage.ts:409  
Risk: Callers passing `{ email }` are safe only because `ensureMongooseDoc` fetches the user by email before billing. If a future caller passes an arbitrary object without `_id`/email, prod throws/skips rather than charging.  
Fix: Keep lint/test asserting billable callers pass a real user doc or email; effort S.  
Confidence: verified

[P2] `trackAiDialerCentsUsage` is active and not listed in map caller inventory — lib/billing/trackAiDialerSessionUsage.ts:285  
Risk: It has correct `userEmail` eligibility checks, but the map inventory focused on `trackAiDialerSessionUsage`; future AI cents callers should be inventoried too. No live caller verified in this pass.  
Fix: Add it to future repo-map money scans and tests; effort S.  
Confidence: likely

## Verified Invariants

- `trackUsage` resolves the provided `user` into a real `User` document at `lib/billing/trackUsage.ts:399-415`; sampled callers pass either `user` or `{ email }`.
- Central usage eligibility guard blocks usage-style sources unless `hasEverPaid`, not `billingBlocked`, and has `stripeCustomerId` at `lib/billing/trackUsage.ts:149-180`.
- BillingEvent idempotency/claim is present: upsert by `{source, sourceId, amountCents}` at `lib/billing/trackUsage.ts:192-207`, fail-closed on unresolved `charging` at `lib/billing/trackUsage.ts:230-238`, and atomic claim before Stripe at `lib/billing/trackUsage.ts:249-263`.
- AI session billing requires `sessionId` and `userEmail`, looks up the matching `AICallSession`, and increments only newly elapsed seconds at `lib/billing/trackAiDialerSessionUsage.ts:66-110`.
- Triple stop cannot triple-bill the same seconds: `billedSeconds` optimistic lock at `lib/billing/trackAiDialerSessionUsage.ts:108-124`; session stop, watchdog running sweep, and watchdog ended sweep all call this same function.
- AI session charge source id is replay-stable from billed total at `lib/billing/trackAiDialerSessionUsage.ts:234-248`.
- A2P fee is idempotent via `BillingEvent` source `a2p_fee` / sourceId `a2p:<stripeCustomerId>` at `lib/billing/trackUsage.ts:623-649`, plus legacy Stripe customer metadata at `lib/billing/trackUsage.ts:634-638`.
- Legacy `trackAiDialerUsage` is inert: it throws unconditionally at `lib/billing/trackAiDialerUsage.ts:5-12`.

## Meter Caller Adjudication

- `google/calendar/book-appointment.ts:745,773`: passes full `user` to `trackUsage`; eligible.
- `lib/twilio/sendSMS.ts:731,734`: passes full `user`; self-billed path records zero-dollar `twilio-self`.
- `twilio/status-callback.ts:456` and `twilio/voice-status.ts:522`: pass resolved billing user after call billing lock.
- `twilio/inbound-sms.ts:698,1348`: passes `{ email: _lastInboundUserEmailForBilling }`; `trackUsage` resolves the real user by email before eligibility.
- `calls/transcribe-recording.ts:125`, `lib/ai/generateCallCoachReport.ts:81`: pass `{ email: args.userEmail }`; central resolver/guard applies.
- `ai/generate-summary.ts:86` and `lib/ai/handleAIResponse.ts:248`: pass full user object.
- `a2p/status-callback.ts:568`, `a2p/sync.ts:625,784`, `lib/twilio/syncA2P.ts:582`: call `chargeA2PApprovalIfNeeded({ user })`, which resolves user doc and checks idempotent BillingEvent.

## Ranked Section List

1. P1 operational gap: stuck BillingEvents are safe but silent.
2. P2 add tests/inventory for meter caller identity and `trackAiDialerCentsUsage`.

# 07 Signup And Trial

Static audit only. No Stripe, DB, or email calls were executed.

## Findings

| rank | finding | evidence |
|---|---|---|
| P1 | Checkout/subscription creation can be called with body email when no session exists; it requires verified email for non-legacy users, but identity is weaker than session-only. | Effective email uses `session?.user?.email || bodyEmail` at `pages/api/create-subscription.ts:121`; email verification gate at `pages/api/create-subscription.ts:125`. |
| P1 | `set-default-payment-method` is unauthenticated and body-email driven, but verifies the payment method belongs to the Stripe customer before granting trial. Risk is mostly endpoint abuse/DoS rather than direct account takeover. | Body email/payment method at `pages/api/stripe/set-default-payment-method.ts:16`; customer lookup at `pages/api/stripe/set-default-payment-method.ts:29`; ownership check at `pages/api/stripe/set-default-payment-method.ts:54`. |
| P2 | Trial window starts at registration time, while trial access starts only after card setup. Users delayed at email verification/billing can lose calendar trial days. | `trialStartedAt` set at `pages/api/register.ts:177`; `trialEndsAt` computed at `pages/api/register.ts:178`; card-gated trial grant at `lib/billing/grantTrialIfEligible.ts:111`. |
| P2 | Legacy account enforcement bypass depends on `ACCOUNT_ACTIVATION_ENFORCEMENT_STARTED_AT`; verify production value is intentional. | Default cutoff at `pages/api/create-subscription.ts:9`; activation helper cutoff at `lib/billing/requireActivatedAccount.ts:3`; legacy bypass at `lib/billing/requireActivatedAccount.ts:13`. |

## Flow Map

| step | behavior | evidence |
|---|---|---|
| Register | Creates pending non-admin user, Stripe customer best-effort, 7-day trial timestamps, no card on file. | `pages/api/register.ts:177`; `pages/api/register.ts:215`; `pages/api/register.ts:230`; `pages/api/register.ts:236`; `pages/api/register.ts:240`. |
| Verify email | Frontend sends verified users to billing with `trial=1`. | `pages/verify-email.tsx:32`; `pages/verify-email.tsx:33`. |
| App activation gate | Unactivated authed users are redirected to billing. | `pages/_app.tsx:138`; `pages/_app.tsx:146`. |
| Create subscription | Creates/reuses Stripe subscription and applies remaining trial days. | `pages/api/create-subscription.ts:145`; `pages/api/create-subscription.ts:203`; `pages/api/create-subscription.ts:207`. |
| Save card | Sets default payment method and grants trial if eligible. | `pages/api/stripe/set-default-payment-method.ts:39`; `pages/api/stripe/set-default-payment-method.ts:72`. |
| Trial fraud controls | Blocks duplicate granted trial by email or card fingerprint. | `lib/billing/grantTrialIfEligible.ts:63`; `lib/billing/grantTrialIfEligible.ts:82`. |
| Activated account predicate | Requires admin, legacy, verified+card, trialGranted, or hasEverPaid. | `lib/billing/requireActivatedAccount.ts:13`; `lib/billing/requireActivatedAccount.ts:17`; `lib/billing/requireActivatedAccount.ts:20`. |

## Adjudication

Cardless full-product trial was not found in the main activation path. Registration creates `subscriptionStatus: "pending"` and `trialGranted: false` for normal users at `pages/api/register.ts:230` and `pages/api/register.ts:236`; activation requires a saved card/trial grant or payment at `lib/billing/requireActivatedAccount.ts:17`.


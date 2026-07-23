# CoveCRM hosted social runner

The hosted runner keeps one Browserbase Context per customer/platform and creates short-lived browser sessions against that context. Customers enter credentials and MFA directly into the provider live view; CoveCRM never accepts or stores passwords or verification codes.

Required production environment variables:

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `CRON_SECRET`
- the existing email configuration used by `lib/email.ts` for reauthentication alerts

`/api/cron/recruiting-cloud-worker` is scheduled once per minute in `vercel.json`. It leases accounts before opening a browser, processes up to three ordered actions in one session, and releases the session when the batch completes. Browserbase recording and session logging are disabled so login screens and messages are not retained in provider replays. The persistent Context is deleted when the customer disconnects.

Do not enable this preview for additional users until the Browserbase project, billing limits, retention/recording settings, and the applicable platform approvals have been configured and reviewed.

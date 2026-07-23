# CoveCRM Social Companion

Manifest V3 browser companion for recipient-locked recruiting jobs. It uses the user's existing LinkedIn or Instagram browser session. It must never request, read, store, or transmit social passwords, login codes, cookies, local storage, or session tokens.

## Local installation

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this directory.
4. In CoveCRM's admin-only Social Recruiting Lab, create a one-time pairing code.
5. Open the extension, enter that code, read and accept the agreement, then pair.
6. Start a recruiting campaign in CoveCRM. The extension begins checking the queue automatically.

The backend starts every new companion paused until the customer launches a campaign. The admin pause and local extension pause remain independent kill switches. The extension creates one dedicated minimized runner window and opens all temporary work tabs there with `active: false`, so it never navigates or replaces the customer's active tab. Jobs are processed one at a time with an expiring lease, a minimum interval, a daily cap, a locked profile URL, a display-name check, and an idempotency key. Changed or ambiguous page controls fail closed.

// lib/a2p/notifications.ts
/**
 * Lightweight notifications shim used by A2P flows.
 * Supports RESEND_API_KEY or SENDGRID_API_KEY. If neither is set,
 * we log and resolve without throwing so the pipeline stays 100% automated.
 */

type EmailBase = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/**
 * FROM_EMAIL rules:
 * - Prefer explicit NOTIFY_FROM_EMAIL (so you can override just for these).
 * - Then fall back to EMAIL_FROM (same as the rest of the app).
 * - Then other legacy vars.
 * - FINAL fallback is a verified @covecrm.com address, NOT .app.
 *
 * Make sure your Resend domain config includes covecrm.com and that
 * noreply@covecrm.com (or whatever you use here) is allowed.
 */
const FROM_EMAIL =
  process.env.NOTIFY_FROM_EMAIL ||
  process.env.EMAIL_FROM ||
  process.env.SENDGRID_FROM_EMAIL ||
  process.env.RESEND_FROM_EMAIL ||
  "noreply@covecrm.com";

/** Simple sleep helper for rate-limit backoff */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendWithResend(msg: EmailBase) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const payload = {
    from: FROM_EMAIL,
    to: [msg.to],
    subject: msg.subject,
    html: msg.html ?? `<pre>${msg.text}</pre>`,
    text: msg.text,
  };

  // Try once, and on 429 back off briefly and retry once.
  const attempt = async (): Promise<boolean | "retry429"> => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) return true;

    const body = await res.text().catch(() => "");
    console.warn("Resend send error:", res.status, body);

    if (res.status === 429) {
      return "retry429";
    }

    return false;
  };

  const first = await attempt();
  if (first === true) return true;

  if (first === "retry429") {
    // Resend allows 2 req/s; a ~700ms pause is usually enough
    await sleep(700);
    const second = await attempt();
    if (second === true) return true;
  }

  return false;
}

async function sendWithSendGrid(msg: EmailBase) {
  const key = process.env.SENDGRID_API_KEY;
  if (!key) return false;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: msg.to }] }],
      from: { email: FROM_EMAIL },
      subject: msg.subject,
      content: [
        msg.html
          ? { type: "text/html", value: msg.html }
          : { type: "text/plain", value: msg.text },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("SendGrid send error:", res.status, body);
    return false;
  }
  return true;
}

async function safeSendEmail(msg: EmailBase) {
  // Try Resend, then SendGrid, else soft-fail
  if (await sendWithResend(msg)) return true;
  if (await sendWithSendGrid(msg)) return true;
  console.log(
    `[notifications] No email provider configured. Would have sent -> to: ${msg.to}, subject: ${msg.subject}`,
  );
  return false;
}

export async function sendA2PApprovedEmail(opts: {
  to: string;
  name?: string;
  dashboardUrl: string;
}) {
  const subject = "✅ A2P Campaign Approved";
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi there,";
  const text = `${greeting}

Great news — your A2P campaign has been approved and texting is ready.

Open your dashboard to start sending:
${opts.dashboardUrl}

— CoveCRM`;
  const html = `
    <p>${greeting}</p>
    <p>Great news — your <strong>A2P campaign has been approved</strong> and texting is ready.</p>
    <p><a href="${opts.dashboardUrl}">Open your dashboard</a> to start sending.</p>
    <p>— CoveCRM</p>
  `;
  await safeSendEmail({ to: opts.to, subject, text, html });
}

export async function sendA2PDeclinedEmail(opts: {
  to: string;
  name?: string;
  reason?: string;
  helpUrl: string;
}) {
  const subject = "⚠️ A2P Campaign Requires Changes";
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi there,";
  const reason = opts.reason ? `Reason: ${opts.reason}\n\n` : "";
  const text = `${greeting}

Your A2P campaign was not approved yet.
${reason}Please review the checklist and resubmit:
${opts.helpUrl}

— CoveCRM`;
  const html = `
    <p>${greeting}</p>
    <p>Your <strong>A2P campaign was not approved</strong> yet.</p>
    ${opts.reason ? `<p><em>Reason:</em> ${opts.reason}</p>` : ""}
    <p>Please review the checklist and resubmit: <a href="${opts.helpUrl}">${opts.helpUrl}</a></p>
    <p>— CoveCRM</p>
  `;
  await safeSendEmail({ to: opts.to, subject, text, html });
}

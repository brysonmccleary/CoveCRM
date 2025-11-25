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

const FROM_EMAIL =
  process.env.NOTIFY_FROM_EMAIL ||
  process.env.SENDGRID_FROM_EMAIL ||
  process.env.RESEND_FROM_EMAIL ||
  "CoveCRM <no-reply@covecrm.com>"; // verified domain / fallback

// Simple sleep helper for rate-limit backoff
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendWithResend(msg: EmailBase) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [msg.to],
        subject: msg.subject,
        html: msg.html ?? `<pre>${msg.text}</pre>`,
        text: msg.text,
      }),
    });

    if (res.ok) {
      return true;
    }

    const body = await res.text().catch(() => "");
    console.warn("Resend send error:", res.status, body);

    // If we hit a rate limit, wait and retry up to maxAttempts
    if (res.status === 429 && attempt < maxAttempts) {
      // Try to respect Retry-After header if present
      const retryAfter = res.headers.get("retry-after");
      let delayMs = 600; // default ~0.6s

      if (retryAfter) {
        const asNumber = Number(retryAfter);
        if (!Number.isNaN(asNumber) && asNumber > 0) {
          delayMs = asNumber * 1000;
        }
      }

      await sleep(delayMs);
      continue;
    }

    // For non-rate-limit errors or last attempt, give up
    return false;
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
  // Try Resend (with backoff), then SendGrid, else soft-fail
  if (await sendWithResend(msg)) return true;
  if (await sendWithSendGrid(msg)) return true;
  console.log(
    `[notifications] No email provider configured or all providers failed. Would have sent -> to: ${msg.to}, subject: ${msg.subject}`,
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
  helpUrl?: string;
}) {
  const subject = "⚠️ A2P Campaign Requires Changes";
  const greeting = opts.name ? `Hi ${opts.name},` : "Hi there,";

  const reasonLine = opts.reason
    ? `Reason from carrier: ${opts.reason} (this is the exact text they sent).\n\n`
    : "";

  // Only include a help link if it's NOT the old 404 checklist URL
  const hasValidHelpUrl =
    !!opts.helpUrl &&
    !/\/help\/a2p-checklist\/?$/i.test(opts.helpUrl || "");

  const extraHelpText = hasValidHelpUrl
    ? `You can also review this checklist:\n${opts.helpUrl}\n\n`
    : "";

  const text = `${greeting}

Your A2P campaign was not approved yet.
${reasonLine}Here are common fixes:
- Make sure your legal business name, EIN, and address exactly match your official records.
- Make sure your website is live and clearly shows what your business does.
- Make sure your sample messages clearly describe what you send and include opt-out language (e.g. "Reply STOP to opt out").

Log into your CoveCRM account, open Settings → A2P Registration, update your details, and resubmit.
${extraHelpText}If you're not sure what to change, just reply to this email and our team will help.

— CoveCRM`;

  const htmlReason = opts.reason
    ? `<p><strong>Reason from carrier:</strong> ${opts.reason} <span style="color:#64748b;font-size:12px">(this is the exact text they sent)</span></p>`
    : "";

  const htmlChecklist = hasValidHelpUrl
    ? `<p>You can also review this checklist: <a href="${opts.helpUrl}">${opts.helpUrl}</a></p>`
    : "";

  const html = `
    <p>${greeting}</p>
    <p>Your <strong>A2P campaign was not approved</strong> yet.</p>
    ${htmlReason}
    <p>Here are common fixes:</p>
    <ul>
      <li>Make sure your legal business name, EIN, and address exactly match your official records.</li>
      <li>Make sure your website is live and clearly shows what your business does.</li>
      <li>Make sure your sample messages clearly describe what you send and include opt-out language (e.g. "Reply STOP to opt out").</li>
    </ul>
    <p>Then log into your CoveCRM account, open <strong>Settings → A2P Registration</strong>, update your details, and resubmit.</p>
    ${htmlChecklist}
    <p>If you're not sure what to change, just reply to this email and our team will help.</p>
    <p>— CoveCRM</p>
  `;

  await safeSendEmail({ to: opts.to, subject, text, html });
}

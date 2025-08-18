// /lib/email.ts
import nodemailer from "nodemailer";
import { Resend } from "resend";

const {
  // SMTP (fallback)
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  SMTP_FROM,

  // Resend (preferred)
  RESEND_API_KEY,
  EMAIL_FROM,

  // Admin recipients
  AFFILIATE_APPS_EMAIL,
  ADMIN_EMAIL,
  EMAIL_SUPPORT,
} = process.env;

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export type SendEmailResult = { ok: boolean; id?: string; error?: string };

function ensureSmtpConfig() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw new Error(
      "Missing SMTP config. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM."
    );
  }
}

/** Legacy/general SMTP sender (kept for existing usages) */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string
): Promise<SendEmailResult> {
  try {
    ensureSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(SMTP_SECURE || "true").toLowerCase() === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const info = await transporter.sendMail({ from: SMTP_FROM, to, subject, html });
    return { ok: true, id: info.messageId };
  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("sendEmail error:", err?.message || err);
    } else {
      console.warn("sendEmail error");
    }
    return { ok: false, error: err?.message || "Email send failed" };
  }
}

/** Prefer Resend for new templates. Falls back to SMTP if Resend not configured. */
async function sendViaResend({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}): Promise<SendEmailResult> {
  try {
    if (!resend || !EMAIL_FROM) return await sendEmail(to, subject, html);
    const result = await resend.emails.send({ from: EMAIL_FROM, to, subject, html });
    if ((result as any)?.error)
      throw new Error((result as any).error?.message || "Resend send failed");
    return { ok: true, id: (result as any)?.data?.id };
  } catch (e: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("sendViaResend error:", e?.message || e);
    } else {
      console.warn("sendViaResend error");
    }
    return { ok: false, error: e?.message || "Email send failed" };
  }
}

/* ---------- Existing templates ---------- */

export function renderLeadBookingEmail(opts: {
  leadName?: string;
  agentName?: string;
  startISO: string;
  endISO: string;
  title?: string;
  description?: string;
  eventUrl?: string;
}) {
  const { leadName, agentName, startISO, endISO, title, description, eventUrl } = opts;
  const start = new Date(startISO).toLocaleString();
  const end = new Date(endISO).toLocaleString();
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
      <h2>Appointment Confirmed</h2>
      <p>Hi ${leadName || "there"},</p>
      <p>Your call with ${agentName || "our team"} is confirmed.</p>
      <ul>
        <li><b>Topic:</b> ${title || "Consultation"}</li>
        <li><b>Starts:</b> ${start}</li>
        <li><b>Ends:</b> ${end}</li>
      </ul>
      ${description ? `<p>${description}</p>` : ""}
      ${eventUrl ? `<p><a href="${eventUrl}">View event</a></p>` : ""}
      <p>Talk soon,<br/>CRM Cove</p>
    </div>
  `;
}

export function renderAgentBookingEmail(opts: {
  agentName?: string;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  startISO: string;
  endISO: string;
  title?: string;
  description?: string;
  leadUrl?: string;
  eventUrl?: string;
}) {
  const { agentName, leadName, leadPhone, leadEmail, startISO, endISO, title, description, leadUrl, eventUrl } = opts;
  const start = new Date(startISO).toLocaleString();
  const end = new Date(endISO).toLocaleString();
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
      <h2>New Booking</h2>
      <p>Hi ${agentName || "Agent"}, you’ve got a new appointment.</p>
      <ul>
        <li><b>Lead:</b> ${leadName || "Unknown"} ${leadUrl ? `— <a href="${leadUrl}">Open lead</a>` : ""}</li>
        ${leadPhone ? `<li><b>Phone:</b> ${leadPhone}</li>` : ""}
        ${leadEmail ? `<li><b>Email:</b> ${leadEmail}</li>` : ""}
        <li><b>Topic:</b> ${title || "Consultation"}</li>
        <li><b>Starts:</b> ${start}</li>
        <li><b>Ends:</b> ${end}</li>
      </ul>
      ${description ? `<p>${description}</p>` : ""}
      ${eventUrl ? `<p><a href="${eventUrl}">View calendar event</a></p>` : ""}
      <p>— CRM Cove</p>
    </div>
  `;
}

/* ========== NEW: Agent appointment notice with state + phone (for AI/dial bookings) ========== */

function escapeHtml(str: string) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDateTimeFriendly(timeISO: string, tzLabel?: string) {
  try {
    const d = new Date(timeISO);
    const when = d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
    return tzLabel ? `${when} ${tzLabel}` : when;
  } catch {
    return timeISO;
  }
}

export function renderAgentAppointmentNotice(opts: {
  agentName?: string;
  leadName: string;
  phone: string;
  state?: string;
  timeISO: string;
  timezone?: string;     // e.g. "CST" or "CDT"
  source?: "AI" | "Dialer" | "Manual";
  eventUrl?: string;
}) {
  const pretty = formatDateTimeFriendly(opts.timeISO, opts.timezone);
  const who = escapeHtml(opts.leadName);
  const ph = escapeHtml(opts.phone);
  const st = escapeHtml(opts.state || "—");
  const src = escapeHtml(opts.source || "Manual");

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">New appointment booked</h2>
      <p style="margin:0 0 12px 0">Hi ${escapeHtml(opts.agentName || "there")},</p>
      <table style="border-collapse:collapse;margin:8px 0 12px 0">
        <tr><td style="padding:4px 8px;color:#64748b">Client</td><td style="padding:4px 8px"><b>${who}</b></td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Phone</td><td style="padding:4px 8px">${ph}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">State</td><td style="padding:4px 8px">${st}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Time</td><td style="padding:4px 8px">${escapeHtml(pretty)}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Booked via</td><td style="padding:4px 8px">${src}</td></tr>
        ${opts.eventUrl ? `<tr><td style="padding:4px 8px;color:#64748b">Calendar</td><td style="padding:4px 8px"><a href="${opts.eventUrl}">Open event</a></td></tr>` : ""}
      </table>
      <p style="margin:16px 0 0 0">Have a great call! — CRM Cove</p>
    </div>
  `;
}

/**
 * Send an "appointment booked" email to the agent.
 * Includes client name, phone, state, time, and optional calendar link.
 * Uses Resend if configured; falls back to SMTP.
 */
export async function sendAppointmentBookedEmail(opts: {
  to: string;                // agent email
  agentName?: string;
  leadName: string;
  phone: string;
  state?: string;
  timeISO: string;           // event start in ISO
  timezone?: string;         // e.g. "CST"/"CDT"
  source?: "AI" | "Dialer" | "Manual";
  eventUrl?: string;
}): Promise<SendEmailResult> {
  const pretty = formatDateTimeFriendly(opts.timeISO, opts.timezone);
  const subject = `📅 New appointment: ${opts.leadName} — ${pretty}`;
  const html = renderAgentAppointmentNotice(opts);
  return sendViaResend({ to: opts.to, subject, html });
}

/* ---------- Password reset ---------- */

function renderPasswordResetEmail(resetUrl: string) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
      <h2>Reset your password</h2>
      <p>We received a request to reset your password. Click the button below to set a new one.</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#111;border:1px solid #ccc;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">
          Reset Password
        </a>
      </p>
      <p>This link will expire in 1 hour. If you didn’t request this, you can safely ignore this email.</p>
      <p>— CRM Cove</p>
    </div>
  `;
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<SendEmailResult> {
  const subject = "Reset your CRM Cove password";
  const html = renderPasswordResetEmail(opts.resetUrl);
  return sendViaResend({ to: opts.to, subject, html });
}

/** Welcome */
export function renderWelcomeEmail(name?: string) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Welcome to Cove CRM${name ? `, ${name}` : ""}!</h2>
      <p style="margin:0 0 12px 0">
        You’re in. We built Cove to help you call, text, and book faster—without the busywork.
      </p>
      <p style="margin:0 0 12px 0">
        Got questions while you’re using the app? Click the <b>Assistant</b> button in the bottom-right.
        It can help with almost everything: setup, calling, texting, booking, and more.
      </p>
      <p style="margin:0 0 12px 0">
        If the Assistant can’t answer something, our team is here:
        <a href="mailto:${EMAIL_SUPPORT || "support@covecrm.com"}">${EMAIL_SUPPORT || "support@covecrm.com"}</a>.
      </p>
      <p style="margin:16px 0 0 0">— The Cove CRM Team</p>
    </div>
  `;
}

export async function sendWelcomeEmail(opts: {
  to: string;
  name?: string;
}): Promise<SendEmailResult> {
  const subject = "Welcome to Cove CRM";
  const html = renderWelcomeEmail(opts.name);
  return sendViaResend({ to: opts.to, subject, html });
}

/* ---------- Affiliate: Admin notification on application ---------- */

function renderAffiliateApplicationAdminEmail(opts: {
  name: string;
  email: string;
  company: string;
  agents: string | number;
  promoCode: string;
  timestampISO?: string;
}) {
  const ts = opts.timestampISO ? new Date(opts.timestampISO) : new Date();
  const when = `${ts.toLocaleDateString()} ${ts.toLocaleTimeString()}`;
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">New Affiliate Application</h2>
      <p style="margin:0 0 12px 0">A new affiliate has applied to the Cove CRM program.</p>
      <table style="border-collapse:collapse">
        <tbody>
          <tr><td style="padding:4px 8px"><b>Name</b></td><td style="padding:4px 8px">${opts.name}</td></tr>
          <tr><td style="padding:4px 8px"><b>Email</b></td><td style="padding:4px 8px">${opts.email}</td></tr>
          <tr><td style="padding:4px 8px"><b>Company</b></td><td style="padding:4px 8px">${opts.company}</td></tr>
          <tr><td style="padding:4px 8px"><b># Agents</b></td><td style="padding:4px 8px">${String(
            opts.agents
          )}</td></tr>
          <tr><td style="padding:4px 8px"><b>Requested Code</b></td><td style="padding:4px 8px">${
            opts.promoCode
          }</td></tr>
          <tr><td style="padding:4px 8px"><b>Submitted</b></td><td style="padding:4px 8px">${when}</td></tr>
        </tbody>
      </table>
      <p style="margin:16px 0 0 0">— Cove CRM</p>
    </div>
  `;
}

export async function sendAffiliateApplicationAdminEmail(opts: {
  to?: string | string[];
  name: string;
  email: string;
  company: string;
  agents: string | number;
  promoCode: string;
  timestampISO?: string;
}): Promise<SendEmailResult> {
  const recipient = opts.to || AFFILIATE_APPS_EMAIL || ADMIN_EMAIL;
  if (!recipient) {
    console.warn(
      "Affiliate admin email not sent: no AFFILIATE_APPS_EMAIL / ADMIN_EMAIL configured."
    );
    return { ok: false, error: "No admin recipient configured" };
  }
  const subject = `New Affiliate Application — ${opts.name} (${opts.promoCode})`;
  const html = renderAffiliateApplicationAdminEmail(opts);
  return sendViaResend({ to: recipient, subject, html });
}

/* ---------- Affiliate: Notify affiliate when approved (via Stripe promo code going live) ---------- */

function renderAffiliateApprovedEmail(opts: {
  name?: string;
  promoCode: string;     // final normalized code to show
  dashboardUrl?: string; // optional link back into app
}) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">You're approved 🎉</h2>
      <p style="margin:0 0 12px 0">
        ${opts.name ? `Hi ${opts.name}, ` : ""}your Cove CRM affiliate application has been approved.
      </p>
      <p style="margin:0 0 12px 0">
        Your referral code is <b>${opts.promoCode}</b>. Share it anywhere you like. When people sign up with your code, their discounts and your commissions apply automatically.
      </p>
      ${
        opts.dashboardUrl
          ? `<p style="margin:0 0 12px 0"><a href="${opts.dashboardUrl}">Open your affiliate dashboard</a></p>`
          : ""
      }
      <p style="margin:0 0 12px 0">Thanks for partnering with us! — The Cove CRM Team</p>
    </div>
  `;
}

export async function sendAffiliateApprovedEmail(opts: {
  to: string;
  name?: string;
  promoCode?: string;     // accept either promoCode…
  code?: string;          // …or code (from Stripe event)
  dashboardUrl?: string;
}): Promise<SendEmailResult> {
  const codeStr = (opts.promoCode || opts.code || "").toString().toUpperCase();
  const subject = codeStr
    ? `Cove CRM — Your affiliate code ${codeStr} is live`
    : `Cove CRM — Your affiliate code is live`;
  const html = renderAffiliateApprovedEmail({
    name: opts.name,
    promoCode: codeStr || "YOURCODE",
    dashboardUrl: opts.dashboardUrl,
  });
  return sendViaResend({ to: opts.to, subject, html });
}

/* ---------- Affiliate: Notify affiliate when Stripe onboarding completes ---------- */

function renderAffiliateOnboardingCompleteEmail(opts: { name?: string }) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Payouts ready ✅</h2>
      <p style="margin:0 0 12px 0">
        ${opts.name ? `Hi ${opts.name}, ` : ""}your Stripe Connect onboarding is complete. Payouts for your affiliate commissions are now enabled.
      </p>
      <p style="margin:0 0 12px 0">
        You can return to your dashboard anytime to see referrals and payouts.
      </p>
      <p style="margin:16px 0 0 0">— The Cove CRM Team</p>
    </div>
  `;
}

export async function sendAffiliateOnboardingCompleteEmail(opts: {
  to: string;
  name?: string;
}): Promise<SendEmailResult> {
  const subject = "Cove CRM — Affiliate payouts enabled";
  const html = renderAffiliateOnboardingCompleteEmail({ name: opts.name });
  return sendViaResend({ to: opts.to, subject, html });
}

/* ---------- Affiliate: Payout email ---------- */

export function renderAffiliatePayoutEmail(opts: {
  amount: number;
  currency?: string; // "USD"
  periodStart?: string;
  periodEnd?: string;
  balanceAfter?: number;
  dashboardUrl?: string;
}) {
  const currency = (opts.currency || "USD").toUpperCase();
  const period =
    opts.periodStart && opts.periodEnd
      ? `${new Date(opts.periodStart).toLocaleDateString()} — ${new Date(
          opts.periodEnd
        ).toLocaleDateString()}`
      : "recent activity";

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Your affiliate payout is on the way 🎉</h2>
      <p style="margin:0 0 8px 0">Amount: <b>$${opts.amount.toFixed(2)} ${currency}</b></p>
      <p style="margin:0 0 8px 0">Period: ${period}</p>
      ${
        typeof opts.balanceAfter === "number"
          ? `<p style="margin:0 0 8px 0">Remaining balance: <b>$${opts.balanceAfter.toFixed(
              2
            )}</b></p>`
          : ""
      }
      ${
        opts.dashboardUrl
          ? `<p style="margin:12px 0 0 0"><a href="${opts.dashboardUrl}">View your affiliate dashboard</a></p>`
          : ""
      }
      <p style="margin:16px 0 0 0">Thanks for sharing Cove! — The Cove CRM Team</p>
    </div>
  `;
}

export async function sendAffiliatePayoutEmail(opts: {
  to: string;
  amount: number;
  currency?: string;
  periodStart?: string;
  periodEnd?: string;
  balanceAfter?: number;
  dashboardUrl?: string;
}): Promise<SendEmailResult> {
  const subject = `Cove CRM — Affiliate payout $${opts.amount.toFixed(2)}`;
  const html = renderAffiliatePayoutEmail(opts);
  return sendViaResend({ to: opts.to, subject, html });
}

/* ========== NEW: A2P registration status emails (approved / declined) ========== */

function renderA2PApprovedEmail(opts: {
  name?: string;
  dashboardUrl?: string;
}) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Your A2P registration is approved 🎉</h2>
      <p style="margin:0 0 12px 0">
        ${opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ""}great news — your A2P 10DLC registration has been <b>approved</b>.
        You can now send and receive texts in CoveCRM.
      </p>
      ${
        opts.dashboardUrl
          ? `<p style="margin:0 0 12px 0"><a href="${opts.dashboardUrl}">Open your messaging dashboard</a></p>`
          : ""
      }
      <p style="margin:0 0 12px 0">If you have any questions, reply to this email and we’ll help.</p>
      <p style="margin:16px 0 0 0">— The Cove CRM Team</p>
    </div>
  `;
}

export async function sendA2PApprovedEmail(opts: {
  to: string;
  name?: string;
  dashboardUrl?: string;
}): Promise<SendEmailResult> {
  const subject = "🎉 A2P Approved — You can now text from CoveCRM";
  const html = renderA2PApprovedEmail({ name: opts.name, dashboardUrl: opts.dashboardUrl });
  return sendViaResend({ to: opts.to, subject, html });
}

function renderA2PDeclinedEmail(opts: {
  name?: string;
  reason?: string;
  helpUrl?: string;
}) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">A2P registration needs attention</h2>
      <p style="margin:0 0 12px 0">
        ${opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ""}your A2P 10DLC application was <b>declined</b>.
        ${opts.reason ? `Reason: <i>${escapeHtml(opts.reason)}</i>.` : ""}
      </p>
      <p style="margin:0 0 12px 0">
        Please update your business details and messaging samples, then resubmit.
        ${
          opts.helpUrl
            ? `See our <a href="${opts.helpUrl}">A2P checklist</a> for quick fixes.`
            : ""
        }
      </p>
      <p style="margin:16px 0 0 0">Need help? Reply to this email — we’ll walk you through it.</p>
      <p style="margin:16px 0 0 0">— The Cove CRM Team</p>
    </div>
  `;
}

export async function sendA2PDeclinedEmail(opts: {
  to: string;
  name?: string;
  reason?: string;
  helpUrl?: string;
}): Promise<SendEmailResult> {
  const subject = "A2P Registration Declined — Action Needed";
  const html = renderA2PDeclinedEmail({ name: opts.name, reason: opts.reason, helpUrl: opts.helpUrl });
  return sendViaResend({ to: opts.to, subject, html });
}

// lib/email.ts

// Use CommonJS require for Nodemailer to avoid TS type requirement on @types/nodemailer
// (works fine at runtime and side-steps the "Could not find a declaration file" error)
const nodemailer = require("nodemailer") as any;
import { Resend } from "resend";
import { DateTime } from "luxon";

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

  // Admin recipients / support
  AFFILIATE_APPS_EMAIL,
  ADMIN_EMAIL,
  EMAIL_SUPPORT,
} = process.env;

// Default support/reply-to email for most system messages
const DEFAULT_SUPPORT_EMAIL = EMAIL_SUPPORT || "support@covecrm.com";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export type SendEmailResult = { ok: boolean; id?: string; error?: string };

function ensureSmtpConfig() {
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    throw new Error(
      "Missing SMTP config. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.",
    );
  }
}

/** Legacy/general SMTP sender (kept for existing usages) */
export async function sendEmail(
  to: string | string[],
  subject: string,
  html: string,
  replyTo?: string | string[],
): Promise<SendEmailResult> {
  try {
    ensureSmtpConfig();
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(SMTP_SECURE || "true").toLowerCase() === "true",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    const info = await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    });
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
  replyTo,
}: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string | string[];
}): Promise<SendEmailResult> {
  try {
    // If Resend is not configured or EMAIL_FROM is missing, fall back to SMTP
    if (!resend || !EMAIL_FROM) {
      return await sendEmail(to, subject, html, replyTo);
    }

    const result = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject,
      html,
      // Resend expects `reply_to`
      ...(replyTo ? { reply_to: replyTo } : {}),
    } as any);

    if ((result as any)?.error) {
      throw new Error((result as any).error?.message || "Resend send failed");
    }

    return { ok: true, id: (result as any)?.data?.id };
  } catch (e: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("sendViaResend error:", e?.message || e);
    } else {
      console.warn("sendViaResend error");
    }
    // Do not crash flows – just return an error result
    return { ok: false, error: e?.message || "Email send failed" };
  }
}

/* ---------- Helpers ---------- */

function toISO(input: string | Date) {
  return input instanceof Date ? input.toISOString() : String(input);
}

function escapeHtml(str: string) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Format a booking time in the agent's IANA timezone.
 * This avoids relying on the server's local timezone and keeps emails aligned
 * with the Google Calendar event time.
 */
function formatDateTimeFriendly(timeISO: string, agentTz?: string | null) {
  try {
    const parsed = DateTime.fromISO(timeISO, { setZone: true });
    if (parsed.isValid) {
      const zone = String(agentTz || "").trim();
      const zoned = zone ? parsed.setZone(zone) : parsed;
      if (zoned.isValid) {
        const when = zoned.toFormat("cccc, LLLL d, yyyy 'at' h:mm a");
        const abbr = zone ? zoned.offsetNameShort : "";
        return abbr ? `${when} ${abbr}` : when;
      }

      const when = parsed.toFormat("cccc, LLLL d, yyyy 'at' h:mm a");
      return when;
    }

    return timeISO;
  } catch {
    return timeISO;
  }
}

/**
 * ✅ Robust lead display-name resolver.
 * - Checks many common field shapes (`First Name`/`Last Name`, `firstName`/`lastName`, `Name`, `Full Name`, etc.)
 * - Trims/normalizes whitespace.
 * - If no name fields present, optionally falls back to a phone string.
 * Never returns the literal word "Client" unless YOU pass it in as the fallback.
 */
export function resolveLeadDisplayName(lead: any, fallbackIfEmpty?: string): string {
  if (!lead || typeof lead !== "object") return fallbackIfEmpty || "";

  // Gather candidate fields (very permissive on casing/spacing)
  const get = (k: string) => {
    try {
      const v = (lead as any)[k];
      return typeof v === "string" ? v.trim() : "";
    } catch {
      return "";
    }
  };

  // Common permutations
  const firsts = [
    "First Name", "firstName", "First", "first", "givenName", "given"
  ].map(get).filter(Boolean);
  const lasts = [
    "Last Name", "lastName", "Last", "last", "familyName", "family"
  ].map(get).filter(Boolean);
  const singles = [
    "Name", "name", "Full Name", "fullName", "Full", "displayName"
  ].map(get).filter(Boolean);

  // Prefer explicit first/last
  const first = firsts[0] || "";
  const last = lasts[0] || "";

  if (first || last) {
    return `${first} ${last}`.replace(/\s+/g, " ").trim();
  }

  if (singles.length) {
    return String(singles[0]).replace(/\s+/g, " ").trim();
  }

  // Sometimes data lands in generic "First"/"Last" lowercase
  const altFirst = get("first");
  const altLast = get("last");
  if (altFirst || altLast) {
    return `${altFirst} ${altLast}`.replace(/\s+/g, " ").trim();
  }

  // As a very last resort, try to derive from Notes like "Name: John Doe"
  const notes = get("Notes") || get("notes");
  if (notes && /\bname\s*:\s*([^\n]+)/i.test(notes)) {
    const m = notes.match(/\bname\s*:\s*([^\n]+)/i);
    if (m && m[1]) return m[1].trim();
  }

  // Fallback (phone or empty)
  return (fallbackIfEmpty || "").trim();
}

/* ---------- Existing templates ---------- */

export function renderLeadBookingEmail(opts: {
  leadName?: string;
  agentName?: string;
  startISO: string | Date;
  endISO: string | Date;
  timezone?: string | null;
  title?: string;
  description?: string;
  eventUrl?: string;
}) {
  const {
    leadName,
    agentName,
    startISO,
    endISO,
    timezone,
    title,
    description,
    eventUrl,
  } = opts;
  const start = formatDateTimeFriendly(toISO(startISO), timezone ?? null);
  const end = formatDateTimeFriendly(toISO(endISO), timezone ?? null);
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
      <h2>Appointment Confirmed</h2>
      <p>Hi ${leadName || "there"},</p>
      <p>Your call with ${agentName || "our team"} is confirmed.</p>
      <ul>
        <li><b>Topic:</b> ${escapeHtml(title || "Consultation")}</li>
        <li><b>Starts:</b> ${escapeHtml(start)}</li>
        <li><b>Ends:</b> ${escapeHtml(end)}</li>
      </ul>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      ${eventUrl ? `<p><a href="${eventUrl}">View event</a></p>` : ""}
      <p>Talk soon,<br/>Cove CRM</p>
    </div>
  `;
}

export function renderAgentBookingEmail(opts: {
  agentName?: string;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  startISO: string | Date;
  endISO: string | Date;
  timezone?: string | null;
  title?: string;
  description?: string;
  leadUrl?: string;
  eventUrl?: string;
  // enrichment
  leadType?: string;
  coverageSubject?: string;
  age?: string;
  coverageAmount?: string;
  address?: string;
  city?: string;
  zip?: string;
  state?: string;
}) {
  const {
    agentName,
    leadName,
    leadPhone,
    leadEmail,
    startISO,
    endISO,
    timezone,
    title,
    description,
    leadUrl,
    eventUrl,
    leadType,
    coverageSubject,
    age,
    coverageAmount,
    address,
    city,
    zip,
    state,
  } = opts;
  const start = formatDateTimeFriendly(toISO(startISO), timezone ?? null);
  const end = formatDateTimeFriendly(toISO(endISO), timezone ?? null);

  const row = (label: string, value: string | undefined) =>
    value ? `<tr><td style="padding:4px 8px;color:#64748b;width:140px">${label}</td><td style="padding:4px 8px">${escapeHtml(value)}</td></tr>` : "";

  const addrLine = [address, city, zip].filter(Boolean).join(", ");

  const formatCoverageSubject = (raw: string | undefined, name: string | undefined): string => {
    if (!raw) return "";
    const t = raw.toLowerCase().trim();
    if (t === "just me" || t === "myself" || t === "just myself") return "Just themselves";
    if (t === "me and my spouse" || t === "both" || t === "spouse" || t === "me and spouse") return `${name || "Lead"} and spouse`;
    if (t.includes("girlfriend") || t.includes("partner") || t.includes("significant other")) return `${name || "Lead"} and partner`;
    return raw;
  };
  const coverageFor = formatCoverageSubject(coverageSubject, leadName);

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
      <h2 style="margin:0 0 12px 0">New Booking</h2>
      <p style="margin:0 0 12px 0">Hi ${escapeHtml(agentName || "Agent")}, you’ve got a new appointment.</p>

      <p style="font-weight:700;color:#333;margin:12px 0 4px 0">LEAD INFO</p>
      <table style="border-collapse:collapse;margin:0 0 8px 0">
        ${row("Name", leadName ? `${escapeHtml(leadName)}${leadUrl ? ` — <a href="${leadUrl}">Open lead</a>` : ""}` : undefined)}
        ${row("Phone", leadPhone)}
        ${row("Email", leadEmail)}
        ${row("Address", addrLine || undefined)}
        ${row("State", state)}
        ${row("Age", age)}
      </table>

      <p style="font-weight:700;color:#333;margin:12px 0 4px 0">COVERAGE REQUEST</p>
      <table style="border-collapse:collapse;margin:0 0 8px 0">
        ${row("Lead Type", leadType || title)}
        ${row("Coverage", coverageAmount)}
        ${row("For", coverageFor || undefined)}
      </table>

      <p style="font-weight:700;color:#333;margin:12px 0 4px 0">APPOINTMENT</p>
      <table style="border-collapse:collapse;margin:0 0 8px 0">
        ${row("Starts", start)}
        ${row("Ends", end)}
        ${eventUrl ? `<tr><td style="padding:4px 8px;color:#64748b">Calendar</td><td style="padding:4px 8px"><a href="${eventUrl}">Open event</a></td></tr>` : ""}
      </table>

      ${description ? `<p style="margin:8px 0">${escapeHtml(description)}</p>` : ""}
      <p style="margin:16px 0 0 0">— Cove CRM</p>
    </div>
  `;
}

/* ========== Agent appointment notice with state + phone (for AI/dial bookings) ========== */

export function renderAgentAppointmentNotice(opts: {
  agentName?: string;
  leadName: string;
  phone: string;
  state?: string;
  timeISO: string;
  timezone?: string | null;
  source?: "AI" | "Dialer" | "Manual";
  eventUrl?: string;
  // enrichment
  leadType?: string;
  coverageSubject?: string;
  age?: string;
  coverageAmount?: string;
  address?: string;
  city?: string;
  zip?: string;
  leadEmail?: string;
}) {
  const pretty = formatDateTimeFriendly(opts.timeISO, opts.timezone);
  const who = escapeHtml(opts.leadName);
  const src = escapeHtml(opts.source || "Manual");

  const row = (label: string, value: string | undefined) =>
    value ? `<tr><td style="padding:4px 8px;color:#64748b;width:140px">${label}</td><td style="padding:4px 8px">${escapeHtml(value)}</td></tr>` : "";

  const addrLine = [opts.address, opts.city, opts.zip].filter(Boolean).join(", ");

  const formatCoverageSubject = (raw: string | undefined, name: string): string => {
    if (!raw) return "";
    const t = raw.toLowerCase().trim();
    if (t === "just me" || t === "myself" || t === "just myself") return "Just themselves";
    if (t === "me and my spouse" || t === "both" || t === "spouse" || t === "me and spouse") return `${name} and spouse`;
    if (t.includes("girlfriend") || t.includes("partner") || t.includes("significant other")) return `${name} and partner`;
    return raw;
  };
  const coverageFor = formatCoverageSubject(opts.coverageSubject, opts.leadName);

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">New appointment booked</h2>
      <p style="margin:0 0 12px 0">Hi ${escapeHtml(opts.agentName || "there")},</p>

      <p style="font-weight:700;color:#333;margin:12px 0 4px 0">LEAD INFO</p>
      <table style="border-collapse:collapse;margin:0 0 8px 0">
        <tr><td style="padding:4px 8px;color:#64748b;width:140px">Client</td><td style="padding:4px 8px"><b>${who}</b></td></tr>
        ${row("Phone", opts.phone)}
        ${row("Email", opts.leadEmail)}
        ${row("Address", addrLine || undefined)}
        ${row("State", opts.state)}
        ${row("Age", opts.age)}
      </table>

      <p style="font-weight:700;color:#333;margin:12px 0 4px 0">COVERAGE REQUEST</p>
      <table style="border-collapse:collapse;margin:0 0 8px 0">
        ${row("Lead Type", opts.leadType)}
        ${row("Coverage", opts.coverageAmount)}
        ${row("For", coverageFor || undefined)}
      </table>

      <p style="font-weight:700;color:#333;margin:12px 0 4px 0">APPOINTMENT</p>
      <table style="border-collapse:collapse;margin:0 0 8px 0">
        <tr><td style="padding:4px 8px;color:#64748b;width:140px">Time</td><td style="padding:4px 8px">${escapeHtml(pretty)}</td></tr>
        <tr><td style="padding:4px 8px;color:#64748b">Booked via</td><td style="padding:4px 8px">${src}</td></tr>
        ${opts.eventUrl ? `<tr><td style="padding:4px 8px;color:#64748b">Calendar</td><td style="padding:4px 8px"><a href="${opts.eventUrl}">Open event</a></td></tr>` : ""}
      </table>

      <p style="margin:16px 0 0 0">Have a great call! — Cove CRM</p>
    </div>
  `;
}

/**
 * Send an "appointment booked" email to the agent.
 * Includes client name, phone, state, time, and optional calendar link.
 * Uses Resend if configured; falls back to SMTP.
 */
export async function sendAppointmentBookedEmail(opts: {
  to: string;
  agentName?: string;
  leadName: string;
  phone: string;
  state?: string;
  timeISO: string;
  timezone?: string | null;
  source?: "AI" | "Dialer" | "Manual";
  eventUrl?: string;
  eventLink?: string;
  // enrichment
  leadType?: string;
  coverageSubject?: string;
  age?: string;
  coverageAmount?: string;
  address?: string;
  city?: string;
  zip?: string;
  leadEmail?: string;
}): Promise<SendEmailResult> {
  const pretty = formatDateTimeFriendly(opts.timeISO, opts.timezone ?? null);
  const subject = `📅 New appointment: ${opts.leadName} — ${pretty}`;
  const html = renderAgentAppointmentNotice({
    agentName: opts.agentName,
    leadName: opts.leadName,
    phone: opts.phone,
    state: opts.state,
    timeISO: opts.timeISO,
    timezone: opts.timezone ?? null,
    source: opts.source,
    eventUrl: opts.eventUrl ?? opts.eventLink,
    leadType: opts.leadType,
    coverageSubject: opts.coverageSubject,
    age: opts.age,
    coverageAmount: opts.coverageAmount,
    address: opts.address,
    city: opts.city,
    zip: opts.zip,
    leadEmail: opts.leadEmail,
  });
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
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
      <p>— Cove CRM</p>
    </div>
  `;
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  resetUrl: string;
}): Promise<SendEmailResult> {
  const subject = "Reset your Cove CRM password";
  const html = renderPasswordResetEmail(opts.resetUrl);
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
}

/** Welcome */
export function renderWelcomeEmail(name?: string) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Welcome to Cove CRM${
        name ? `, ${escapeHtml(name)}` : ""
      }!</h2>
      <p style="margin:0 0 12px 0">
        You’re in. We built Cove to help you call, text, and book faster—without the busywork.
      </p>
      <p style="margin:0 0 12px 0">
        Got questions while you’re using the app? Click the <b>Assistant</b> button in the bottom-right.
        It can help with almost everything: setup, calling, texting, booking, and more.
      </p>
      <p style="margin:0 0 12px 0">
        If the Assistant can’t answer something, our team is here:
        <a href="mailto:${EMAIL_SUPPORT || "support@covecrm.com"}">${
    EMAIL_SUPPORT || "support@covecrm.com"
  }</a>.
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
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
}

export async function sendEmailVerificationCode(opts: {
  to: string;
  name?: string;
  code: string;
  verifyUrl?: string;
}): Promise<SendEmailResult> {
  const subject = "Verify your Cove CRM email";
  const safeVerifyUrl = opts.verifyUrl ? escapeHtml(opts.verifyUrl) : "";
  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.5;color:#0f172a">
      <h2>Confirm your Cove CRM email</h2>
      <p>Hi ${escapeHtml(opts.name || "there")},</p>
      <p>Confirm your email to activate your Cove CRM account and continue setup.</p>
      ${
        safeVerifyUrl
          ? `<p style="margin:24px 0">
              <a href="${safeVerifyUrl}" style="display:inline-block;background:#111827;color:#ffffff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">
                Confirm Email
              </a>
            </p>
            <p style="font-size:13px;color:#475569;margin:0 0 18px 0">If the button does not work, copy and paste this link into your browser:<br/><a href="${safeVerifyUrl}">${safeVerifyUrl}</a></p>`
          : ""
      }
      <p style="margin:18px 0 8px 0">You can also enter this fallback code:</p>
      <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:0 0 18px 0">${escapeHtml(opts.code)}</p>
      <p>This link and code expire in 10 minutes.</p>
      <p>If you did not create a Cove CRM account, you can ignore this email.</p>
      <p style="margin:16px 0 0 0">— The Cove CRM Team</p>
    </div>
  `;
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
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
          <tr><td style="padding:4px 8px"><b>Name</b></td><td style="padding:4px 8px">${escapeHtml(
            opts.name,
          )}</td></tr>
          <tr><td style="padding:4px 8px"><b>Email</b></td><td style="padding:4px 8px">${escapeHtml(
            opts.email,
          )}</td></tr>
          <tr><td style="padding:4px 8px"><b>Company</b></td><td style="padding:4px 8px">${escapeHtml(
            opts.company,
          )}</td></tr>
          <tr><td style="padding:4px 8px"><b># Agents</b></td><td style="padding:4px 8px">${escapeHtml(
            String(opts.agents),
          )}</td></tr>
          <tr><td style="padding:4px 8px"><b>Requested Code</b></td><td style="padding:4px 8px">${escapeHtml(
            opts.promoCode,
          )}</td></tr>
          <tr><td style="padding:4px 8px"><b>Submitted</b></td><td style="padding:4px 8px">${escapeHtml(
            when,
          )}</td></tr>
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
      "Affiliate admin email not sent: no AFFILIATE_APPS_EMAIL / ADMIN_EMAIL configured.",
    );
    return { ok: false, error: "No admin recipient configured" };
  }
  const subject = `New Affiliate Application — ${opts.name} (${opts.promoCode})`;
  const html = renderAffiliateApplicationAdminEmail(opts);
  return sendViaResend({
    to: recipient,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
}

/* ---------- Affiliate: Notify affiliate when approved (via Stripe promo code going live) ---------- */

function renderAffiliateApprovedEmail(opts: {
  name?: string;
  promoCode: string;
  dashboardUrl?: string;
}) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">You're approved 🎉</h2>
      <p style="margin:0 0 12px 0">
        ${
          opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ""
        }your Cove CRM affiliate application has been approved.
      </p>
      <p style="margin:0 0 12px 0">
        Your referral code is <b>${escapeHtml(
          opts.promoCode,
        )}</b>. When people sign up with this code, their discount and your commission apply automatically.
      </p>
      <p style="margin:0 0 8px 0">
        Here’s how your deal works:
      </p>
      <ul style="margin:0 0 12px 20px;padding:0;">
        <li style="margin:4px 0;">
          Every referral who uses your code saves <b>$50/month</b> on their Cove CRM subscription.
        </li>
        <li style="margin:4px 0;">
          You earn <b>$25 per active paying user</b> as long as their account stays active.
        </li>
      </ul>
      ${
        opts.dashboardUrl
          ? `<p style="margin:12px 0 12px 0"><a href="${opts.dashboardUrl}">Open your affiliate dashboard</a></p>`
          : ""
      }
      <p style="margin:0 0 12px 0">
        Share your code in your team chats, trainings, and social posts—every active user with your code is money in your pocket.
      </p>
      <p style="margin:16px 0 0 0">Thanks for partnering with us! — The Cove CRM Team</p>
    </div>
  `;
}

export async function sendAffiliateApprovedEmail(opts: {
  to: string;
  name?: string;
  promoCode?: string;
  code?: string;
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
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
}

/* ---------- Affiliate: Notify affiliate when Stripe onboarding completes ---------- */

function renderAffiliateOnboardingCompleteEmail(opts: { name?: string }) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Payouts ready ✅</h2>
      <p style="margin:0 0 12px 0">
        ${
          opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ""
        }your Stripe Connect onboarding is complete. Payouts for your affiliate commissions are now enabled.
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
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
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
          opts.periodEnd,
        ).toLocaleDateString()}`
      : "recent activity";

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Your affiliate payout is on the way 🎉</h2>
      <p style="margin:0 0 8px 0">Amount: <b>$${opts.amount.toFixed(
        2,
      )} ${escapeHtml(currency)}</b></p>
      <p style="margin:0 0 8px 0">Period: ${escapeHtml(period)}</p>
      ${
        typeof opts.balanceAfter === "number"
          ? `<p style="margin:0 0 8px 0">Remaining balance: <b>$${opts.balanceAfter.toFixed(
              2,
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
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
}

/* ========== A2P registration status emails (approved / declined) ========== */

function renderA2PApprovedEmail(opts: {
  name?: string;
  dashboardUrl?: string;
}) {
  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">Your A2P registration is approved 🎉</h2>
      <p style="margin:0 0 12px 0">
        ${
          opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ""
        }great news — your A2P 10DLC registration has been <b>approved</b>.
        You can now send and receive texts in CoveCRM.
      </p>
      ${
        opts.dashboardUrl
          ? `<p style="margin:0 0 12px 0"><a href="${opts.dashboardUrl}">Open your messaging dashboard</a></p>`
          : ""
      }
      <p style="margin:0 0 12px 0">If you have any questions, reply to this email and we’ll help.</p>
      <p style="margin:0 0 12px 0">— The Cove CRM Team</p>
    </div>
  `;
}

export async function sendA2PApprovedEmail(opts: {
  to: string;
  name?: string;
  dashboardUrl?: string;
}): Promise<SendEmailResult> {
  const subject = "🎉 A2P Approved — You can now text from CoveCRM";
  const html = renderA2PApprovedEmail({
    name: opts.name,
    dashboardUrl: opts.dashboardUrl,
  });
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
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
        ${
          opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ""
        }your A2P 10DLC application was <b>declined</b>.
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
  const html = renderA2PDeclinedEmail({
    name: opts.name,
    reason: opts.reason,
    helpUrl: opts.helpUrl,
  });
  return sendViaResend({
    to: opts.to,
    subject,
    html,
    replyTo: DEFAULT_SUPPORT_EMAIL,
  });
}

/* ========== Lead reply notification email ========== */

export function renderLeadReplyNotificationEmail(opts: {
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  folder?: string;
  status?: string;
  message: string;
  receivedAtISO?: string;
  linkUrl?: string; // deep-link to /lead/{id}
}) {
  const when =
    opts.receivedAtISO
      ? new Date(opts.receivedAtISO).toLocaleString()
      : new Date().toLocaleString();

  const bodyHtml = escapeHtml(opts.message || "").replace(/\n/g, "<br/>");

  return `
    <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:#0f172a">
      <h2 style="margin:0 0 12px 0">New Lead Reply</h2>
      <table style="border-collapse:collapse;margin:8px 0 16px 0">
        <tbody>
          ${
            opts.leadName
              ? `<tr><td style="padding:4px 8px;color:#64748b">Lead</td><td style="padding:4px 8px"><b>${escapeHtml(
                  opts.leadName,
                )}</b></td></tr>`
              : ""
          }
          ${
            opts.leadPhone
              ? `<tr><td style="padding:4px 8px;color:#64748b">Phone</td><td style="padding:4px 8px">${escapeHtml(
                  opts.leadPhone,
                )}</td></tr>`
              : ""
          }
          ${
            opts.leadEmail
              ? `<tr><td style="padding:4px 8px;color:#64748b">Email</td><td style="padding:4px 8px">${escapeHtml(
                  opts.leadEmail,
                )}</td></tr>`
              : ""
          }
          ${
            opts.folder
              ? `<tr><td style="padding:4px 8px;color:#64748b">Folder</td><td style="padding:4px 8px">${escapeHtml(
                  opts.folder,
                )}</td></tr>`
              : ""
          }
          ${
            opts.status
              ? `<tr><td style="padding:4px 8px;color:#64748b">Status</td><td style="padding:4px 8px">${escapeHtml(
                  opts.status,
                )}</td></tr>`
              : ""
          }
          <tr><td style="padding:4px 8px;color:#64748b">Received</td><td style="padding:4px 8px">${escapeHtml(
            when,
          )}</td></tr>
          ${
            opts.linkUrl
              ? `<tr><td style="padding:4px 8px;color:#64748b">Lead Link</td><td style="padding:4px 8px"><a href="${opts.linkUrl}">Open in Cove</a></td></tr>`
              : ""
          }
        </tbody>
      </table>
      <div style="padding:12px 14px;border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc">
        <div style="font-size:12px;color:#64748b;margin-bottom:6px">Message</div>
        <div style="line-height:1.5">${bodyHtml || "<i>(no text)</i>"}</div>
      </div>
      <p style="margin:16px 0 0 0">Tip: Reply to this email to respond quickly via your email client.</p>
    </div>
  `;
}

/**
 * Sends the per-user inbound SMS notification email.
 * Subject should be composed by the caller (we keep that logic near the webhook),
 * but From is the app’s configured address and Reply-To is the agent’s email.
 */
export async function sendLeadReplyNotificationEmail(opts: {
  to: string; // agent email (user.email)
  replyTo?: string | string[]; // set to user.email so agent can reply quickly
  subject: string; // e.g. "[New Lead Reply] {Lead Name or Phone} — {first 60 chars}"
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  folder?: string;
  status?: string;
  message: string;
  receivedAtISO?: string;
  linkUrl?: string;
}): Promise<SendEmailResult> {
  const html = renderLeadReplyNotificationEmail({
    leadName: opts.leadName,
    leadPhone: opts.leadPhone,
    leadEmail: opts.leadEmail,
    folder: opts.folder,
    status: opts.status,
    message: opts.message,
    receivedAtISO: opts.receivedAtISO,
    linkUrl: opts.linkUrl,
  });
  return sendViaResend({
    to: opts.to,
    subject: opts.subject,
    html,
    // For lead replies we respect the caller's reply-to (usually the agent)
    replyTo: opts.replyTo || DEFAULT_SUPPORT_EMAIL,
  });
}

import { Resend } from "resend";

type SupportEmailArgs = {
  to: string;
  subject: string;
  body: string;
  html?: string;
};

export function isSupportEmailSendEnabled() {
  return String(process.env.SUPPORT_EMAIL_SEND_ENABLED || "").toLowerCase() === "true";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function bodyToHtml(body: string, html?: string) {
  if (html && /<[^>]+>/.test(html)) return html;
  if (/<(p|br|div|table|ul|ol|li|strong|em|a)\b/i.test(body)) return body;
  return escapeHtml(body).replace(/\r?\n/g, "<br/>");
}

export async function sendSupportEmail({ to, subject, body, html }: SupportEmailArgs) {
  if (!isSupportEmailSendEnabled()) {
    return { ok: false, code: "email_send_disabled", status: "email_send_disabled" };
  }

  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) {
    return { ok: false, code: "resend_not_configured", status: "resend_not_configured" };
  }

  try {
    const resend = new Resend(apiKey);
    const from = process.env.SUPPORT_EMAIL_FROM || "CoveCRM <support@covecrm.com>";
    const result = await resend.emails.send({
      from,
      to,
      subject,
      text: body,
      html: bodyToHtml(body, html),
    });

    if ((result as any)?.error) {
      console.error("[support-email] Resend send failed", (result as any).error);
      return { ok: false, code: "resend_send_failed", status: "resend_send_failed", error: (result as any).error };
    }

    return { ok: true, code: "sent", status: "sent", id: (result as any)?.data?.id || null };
  } catch (err: any) {
    console.error("[support-email] Resend exception", err?.message || err);
    return { ok: false, code: "resend_send_failed", status: "resend_send_failed", error: String(err?.message || err).slice(0, 180) };
  }
}

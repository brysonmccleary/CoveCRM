// lib/email/sendEmail.ts
// Resend wrapper with suppression check, EmailMessage record creation, and status tracking.
// If the sending user has an active verified AgentEmailAccount, uses their SMTP instead of Resend.
// Use CommonJS require for nodemailer (matches lib/email.ts pattern)
const nodemailer = require("nodemailer") as any;

import { Resend } from "resend";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailMessage from "@/models/EmailMessage";
import AgentEmailAccount from "@/models/AgentEmailAccount";
import { checkSuppression } from "./checkSuppression";
import { decrypt } from "@/lib/prospecting/encrypt";
import mongoose from "mongoose";

const resend = new Resend(process.env.RESEND_API_KEY);

export interface SendEmailPayload {
  userId: string | mongoose.Types.ObjectId;
  userEmail: string;
  leadId: string | mongoose.Types.ObjectId;
  to: string;
  /** Raw from address, e.g. "hello@agency.com" */
  from?: string;
  /** Display name prepended to from address */
  fromName?: string;
  replyTo?: string;
  subject: string;
  html: string;
  text?: string;
  campaignId?: string | mongoose.Types.ObjectId;
  enrollmentId?: string | mongoose.Types.ObjectId;
  stepIndex?: number;
  /** Physical mailing address for CAN-SPAM footer (recruiting emails) */
  agentAddress?: string;
}

export interface SendEmailResult {
  ok: boolean;
  suppressed?: boolean;
  messageId?: string;
  emailMessageId?: string;
  error?: string;
  /** true when sent via agent's own SMTP account */
  usedSmtp?: boolean;
}

export async function sendEmailWithTracking(
  payload: SendEmailPayload
): Promise<SendEmailResult> {
  await mongooseConnect();

  const {
    userId,
    userEmail,
    leadId,
    to,
    from,
    fromName,
    replyTo,
    subject,
    html: rawHtml,
    text,
    campaignId,
    enrollmentId,
    stepIndex,
    agentAddress,
  } = payload;

  const normalizedTo = to.toLowerCase().trim();
  const normalizedUserEmail = userEmail.toLowerCase().trim();

  // Inline variable — will be resolved after EmailMessage is created (needs message ID for unsubscribe URL)
  let html = rawHtml;

  // Always check suppression before sending
  const suppressed = await checkSuppression(normalizedUserEmail, normalizedTo);
  if (suppressed) {
    return { ok: false, suppressed: true };
  }

  // Check if this user has a verified AgentEmailAccount to use instead of Resend
  let agentSmtp: any = null;
  try {
    agentSmtp = await AgentEmailAccount.findOne({
      userId,
      active: true,
      isVerified: true,
    }).lean();
  } catch {
    // If model lookup fails, fall back to Resend
    agentSmtp = null;
  }

  // Build from address: prefer agent SMTP's fromName/fromEmail when using SMTP
  const resolvedFromName = fromName || (agentSmtp?.fromName) || "";
  const resolvedFromRaw =
    from || (agentSmtp?.fromEmail) || process.env.EMAIL_FROM || "noreply@covecrm.com";
  const fromAddress = resolvedFromName
    ? `${resolvedFromName} <${resolvedFromRaw}>`
    : resolvedFromRaw;

  // ── CAN-SPAM footer injection ─────────────────────────────────────────────
  // Only inject when the email contains [FOOTER] placeholder (set by AI on recruiting emails)
  if (rawHtml.includes("[FOOTER]")) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com";
    // Note: emailMessage._id not available yet — we use a placeholder resolved below
    const agentName = fromName || resolvedFromRaw;
    const agentEmail = resolvedFromRaw;
    const physicalAddress =
      agentAddress || "CoveCRM, 123 Business Ave, Suite 100, Phoenix, AZ 85001";

    // We need the emailMessage ID for the unsubscribe link, so we'll do a two-pass:
    // 1. Create with placeholder unsubscribe link
    // 2. Replace placeholder after creation
    html = rawHtml.replace(
      "[FOOTER]",
      `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #374151;font-family:Arial,sans-serif;font-size:11px;color:#9ca3af;line-height:1.7;">
<p style="margin:0 0 5px 0;">This email was sent by ${agentName} (${agentEmail}) regarding a professional opportunity in the insurance industry.</p>
<p style="margin:0 0 5px 0;">You are receiving this email because your insurance license information is publicly available through your state's Department of Insurance.</p>
<p style="margin:0 0 5px 0;">To unsubscribe from future emails, <a href="{{UNSUBSCRIBE_URL}}" style="color:#9ca3af;text-decoration:underline;">click here</a>.</p>
<p style="margin:0;">Physical address: ${physicalAddress}</p>
</div>`
    );
  }

  // Create EmailMessage in queued state before attempting send
  const emailMessage = await EmailMessage.create({
    userId,
    userEmail: normalizedUserEmail,
    leadId,
    to: normalizedTo,
    from: fromAddress,
    replyTo: replyTo || "",
    subject,
    html,
    text: text || "",
    direction: "outbound",
    status: "queued",
    ...(campaignId ? { campaignId } : {}),
    ...(enrollmentId ? { enrollmentId } : {}),
    ...(stepIndex !== undefined ? { stepIndex } : {}),
  });

  // Resolve unsubscribe URL now that we have the emailMessage ID
  if (html.includes("{{UNSUBSCRIBE_URL}}")) {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://covecrm.com";
    const unsubUrl = `${baseUrl}/api/email/unsubscribe?mid=${emailMessage._id}`;
    html = html.replaceAll("{{UNSUBSCRIBE_URL}}", unsubUrl);
  }

  // ── Path A: Agent SMTP ────────────────────────────────────────────────────
  if (agentSmtp) {
    try {
      const decryptedPass = decrypt(agentSmtp.smtpPass);

      const transporter = nodemailer.createTransport({
        host: agentSmtp.smtpHost,
        port: agentSmtp.smtpPort || 587,
        secure: agentSmtp.smtpSecure === true,
        auth: { user: agentSmtp.smtpUser, pass: decryptedPass },
      });

      const info = await transporter.sendMail({
        from: fromAddress,
        to: normalizedTo,
        subject,
        html, // footer-injected
        ...(text ? { text } : {}),
        ...(replyTo ? { replyTo } : {}),
      });

      // Update EmailMessage + last used timestamp
      await Promise.all([
        EmailMessage.updateOne(
          { _id: emailMessage._id },
          { $set: { status: "sent", sentAt: new Date() } }
        ),
        AgentEmailAccount.updateOne(
          { _id: agentSmtp._id },
          { $set: { lastUsedAt: new Date() } }
        ),
      ]);

      return {
        ok: true,
        messageId: info.messageId || "",
        emailMessageId: String(emailMessage._id),
        usedSmtp: true,
      };
    } catch (err: any) {
      // SMTP failed — fall through to Resend as backup
      console.warn(
        "[sendEmail] Agent SMTP failed, falling back to Resend:",
        err?.message
      );
    }
  }

  // ── Path B: Resend platform sending ──────────────────────────────────────
  try {
    const sendParams: Parameters<typeof resend.emails.send>[0] = {
      from: fromAddress,
      to: normalizedTo,
      subject,
      html, // footer-injected
      ...(text ? { text } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    };

    const result = await resend.emails.send(sendParams);

    // Resend returns { data: { id }, error } shape
    const resendId = (result as any)?.data?.id || (result as any)?.id || "";

    await EmailMessage.updateOne(
      { _id: emailMessage._id },
      { $set: { status: "sent", resendId, sentAt: new Date() } }
    );

    return {
      ok: true,
      messageId: resendId,
      emailMessageId: String(emailMessage._id),
      usedSmtp: false,
    };
  } catch (err: any) {
    await EmailMessage.updateOne(
      { _id: emailMessage._id },
      { $set: { status: "failed" } }
    );
    console.error("[sendEmailWithTracking] Resend error:", err?.message || err);
    return { ok: false, error: err?.message || "Send failed" };
  }
}

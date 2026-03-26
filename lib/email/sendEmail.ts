// lib/email/sendEmail.ts
// Resend wrapper with suppression check, EmailMessage record creation, and status tracking.
import { Resend } from "resend";
import mongooseConnect from "@/lib/mongooseConnect";
import EmailMessage from "@/models/EmailMessage";
import { checkSuppression } from "./checkSuppression";
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
}

export interface SendEmailResult {
  ok: boolean;
  suppressed?: boolean;
  messageId?: string;
  emailMessageId?: string;
  error?: string;
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
    html,
    text,
    campaignId,
    enrollmentId,
    stepIndex,
  } = payload;

  const normalizedTo = to.toLowerCase().trim();
  const normalizedUserEmail = userEmail.toLowerCase().trim();

  // Always check suppression before sending
  const suppressed = await checkSuppression(normalizedUserEmail, normalizedTo);
  if (suppressed) {
    return { ok: false, suppressed: true };
  }

  // Build from string
  const rawFrom = from || process.env.EMAIL_FROM || "noreply@covecrm.com";
  const fromAddress = fromName ? `${fromName} <${rawFrom}>` : rawFrom;

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

  try {
    const sendParams: Parameters<typeof resend.emails.send>[0] = {
      from: fromAddress,
      to: normalizedTo,
      subject,
      html,
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

// lib/prospecting/sendPlatformPromo.ts
// Sends a CoveCRM platform-level promo email to a single DOI lead.
// Uses the PlatformSender with the lowest current usage under its daily limit.
// Use CommonJS require for nodemailer (matches lib/email.ts pattern)
const nodemailer = require("nodemailer") as any;

import mongooseConnect from "@/lib/mongooseConnect";
import DOILead from "@/models/DOILead";
import PlatformSender from "@/models/PlatformSender";
import PlatformEmailRecord from "@/models/PlatformEmailRecord";
import EmailSuppression from "@/models/EmailSuppression";
import { decrypt } from "./encrypt";

export interface PlatformPromoPayload {
  subject: string;
  html: string;
  text?: string;
}

export interface PlatformPromoResult {
  ok: boolean;
  suppressed?: boolean;
  skipped?: boolean;
  error?: string;
  recordId?: string;
}

// Platform-level sender email — used as the userEmail key for EmailSuppression checks
const PLATFORM_USER_EMAIL = (
  process.env.PLATFORM_EMAIL || "platform@covecrm.com"
).toLowerCase();

export async function sendPlatformPromo(
  doiLeadId: string,
  payload: PlatformPromoPayload
): Promise<PlatformPromoResult> {
  await mongooseConnect();

  const { subject, html, text } = payload;

  // Load the DOI lead
  const lead = await DOILead.findById(doiLeadId).lean() as any;
  if (!lead) return { ok: false, error: "DOI lead not found" };

  // Check global unsubscribe flag on the lead itself
  if (lead.globallyUnsubscribed) {
    return { ok: false, suppressed: true };
  }

  const toEmail = (lead.email as string).toLowerCase().trim();

  // Block synthetic placeholder emails — no real recipient
  if (toEmail.endsWith("@noemail.doilead.local")) {
    return { ok: false, skipped: true };
  }

  // Also check EmailSuppression collection (platform's own suppression list)
  const suppressed = await EmailSuppression.findOne({
    userEmail: PLATFORM_USER_EMAIL,
    email: toEmail,
  })
    .select("_id")
    .lean();

  if (suppressed) {
    return { ok: false, suppressed: true };
  }

  // Pick the active sender with the lowest sentToday that is under dailyLimit
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Reset sentToday for senders whose lastResetAt is before today
  await PlatformSender.updateMany(
    { active: true, lastResetAt: { $lt: today } },
    { $set: { sentToday: 0, lastResetAt: new Date() } }
  );

  const sender = await PlatformSender.findOne({ active: true })
    .where("sentToday").lt(PlatformSender.schema.path("dailyLimit") as any)
    .sort({ sentToday: 1 })
    .lean() as any;

  // Re-query without the schema reference (Mongoose lean doesn't support path comparison)
  const senderRecord = await PlatformSender.findOne({ active: true })
    .sort({ sentToday: 1 })
    .lean() as any;

  if (!senderRecord) {
    return { ok: false, skipped: true, error: "No active platform senders available" };
  }

  if (senderRecord.sentToday >= (senderRecord.dailyLimit || 200)) {
    return { ok: false, skipped: true, error: "All senders at daily limit" };
  }

  // Create tracking record (queued)
  const record = await PlatformEmailRecord.create({
    toEmail,
    doiLeadId: lead._id,
    senderId: senderRecord._id,
    senderEmail: senderRecord.fromEmail,
    subject,
    status: "queued",
    platformSend: true,
  });

  try {
    const decryptedPass = decrypt(senderRecord.smtpPass);

    const transporter = nodemailer.createTransport({
      host: senderRecord.smtpHost,
      port: senderRecord.smtpPort || 587,
      secure: senderRecord.smtpSecure === true,
      auth: { user: senderRecord.smtpUser, pass: decryptedPass },
    });

    await transporter.sendMail({
      from: `${senderRecord.fromName} <${senderRecord.fromEmail}>`,
      to: toEmail,
      subject,
      html,
      ...(text ? { text } : {}),
    });

    // Mark as sent and increment sender count
    await PlatformEmailRecord.updateOne(
      { _id: record._id },
      { $set: { status: "sent", sentAt: new Date() } }
    );

    await PlatformSender.updateOne(
      { _id: senderRecord._id },
      { $inc: { sentToday: 1 } }
    );

    return { ok: true, recordId: String(record._id) };
  } catch (err: any) {
    await PlatformEmailRecord.updateOne(
      { _id: record._id },
      { $set: { status: "failed", error: err?.message || "Send failed" } }
    );
    console.error("[sendPlatformPromo] SMTP error:", err?.message || err);
    return { ok: false, error: err?.message || "SMTP send failed" };
  }
}

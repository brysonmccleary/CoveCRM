// /utils/emailHelpers.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "");

export async function sendAdminNotification({
  subject,
  body,
}: {
  subject: string;
  body: string;
}) {
  if (!process.env.ADMIN_EMAIL) return;

  await resend.emails.send({
    from: "no-reply@covecrm.com",
    to: process.env.ADMIN_EMAIL,
    subject,
    text: body,
  });
}

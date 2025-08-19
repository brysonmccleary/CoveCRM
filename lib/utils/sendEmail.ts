import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export const sendEmail = async ({
  to,
  subject,
  html,
  from,
}: SendEmailOptions) => {
  try {
    const response = await resend.emails.send({
      from: from || process.env.EMAIL_FROM || "noreply@covecrm.com",
      to,
      subject,
      html,
    });

    return response;
  } catch (error) {
    console.error("❌ Email failed to send:", error);
    throw error;
  }
};

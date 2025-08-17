// /utils/sendEmailReceipt.ts
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

interface Props {
  to: string;
  amount: number;
  name: string;
}

export default async function sendEmailReceipt({ to, amount, name }: Props) {
  return resend.emails.send({
    from: "CoveCRM <payments@covecrm.com>",
    to,
    subject: "Your Affiliate Payout Receipt",
    html: `
      <p>Hi ${name},</p>
      <p>You've just been paid <strong>$${amount.toFixed(2)}</strong> from CoveCRM for your affiliate referrals.</p>
      <p>Thanks for being part of the growth!</p>
      <br/>
      <p>— The CoveCRM Team</p>
    `,
  });
}

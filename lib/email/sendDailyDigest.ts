// lib/email/sendDailyDigest.ts
// Send a daily performance digest email to agents who have opted in
import { Resend } from "resend";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import User from "@/models/User";
import CallLog from "@/models/CallLog";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendDailyDigest(userEmail: string): Promise<void> {
  await mongooseConnect();

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // New leads yesterday
  const newLeads = await Lead.countDocuments({
    userEmail,
    createdAt: { $gte: yesterday, $lt: today },
  });

  // Calls yesterday
  const calls = await (CallLog as any).countDocuments?.({
    userEmail,
    createdAt: { $gte: yesterday, $lt: today },
  }) ?? 0;

  // Connected calls
  const connected = await (CallLog as any).countDocuments?.({
    userEmail,
    status: "connected",
    createdAt: { $gte: yesterday, $lt: today },
  }) ?? 0;

  const dateStr = yesterday.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const html = `
    <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px;">
      <h2 style="color:#1e293b;margin-bottom:4px;">Your Daily Summary</h2>
      <p style="color:#64748b;margin-top:0;">${dateStr}</p>
      <div style="background:#fff;border-radius:8px;padding:20px;margin:16px 0;border:1px solid #e2e8f0;">
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
          <span style="color:#64748b;">New Leads</span>
          <strong style="color:#1e293b;">${newLeads}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin-bottom:12px;">
          <span style="color:#64748b;">Total Calls</span>
          <strong style="color:#1e293b;">${calls}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;">
          <span style="color:#64748b;">Connected Calls</span>
          <strong style="color:#22c55e;">${connected}</strong>
        </div>
      </div>
      <p style="color:#94a3b8;font-size:12px;text-align:center;">
        You're receiving this because daily digest is enabled in your CoveCRM settings.
        <a href="https://covecrm.com/dashboard?tab=settings" style="color:#6366f1;">Unsubscribe</a>
      </p>
    </div>
  `;

  await resend.emails.send({
    from: "CoveCRM <updates@covecrm.com>",
    to: userEmail,
    subject: `Your CoveCRM Daily Summary — ${dateStr}`,
    html,
  });
}

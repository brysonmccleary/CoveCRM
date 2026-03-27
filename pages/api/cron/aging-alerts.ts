// pages/api/cron/aging-alerts.ts
// Cron: send email alerts for leads that have been sitting too long with no activity
import type { NextApiRequest, NextApiResponse } from "next";
import { checkCronAuth } from "@/lib/cronAuth";
import mongooseConnect from "@/lib/mongooseConnect";
import Lead from "@/lib/mongo/leads";
import User from "@/models/User";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!checkCronAuth(req)) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Aggregate stale leads per user
  const staleLeads = await Lead.aggregate([
    {
      $match: {
        status: { $in: ["New", "Contacted"] },
        updatedAt: { $lt: sevenDaysAgo },
      },
    },
    {
      $group: {
        _id: "$userEmail",
        count: { $sum: 1 },
        sample: { $first: { firstName: "$First Name", lastName: "$Last Name" } },
      },
    },
  ]);

  let emailsSent = 0;

  for (const group of staleLeads) {
    const userEmail = group._id;
    if (!userEmail) continue;

    const user = await User.findOne({ email: userEmail })
      .select("notifications")
      .lean();
    if (!(user as any)?.notifications?.dripAlerts) continue;

    try {
      await resend.emails.send({
        from: "CoveCRM <alerts@covecrm.com>",
        to: userEmail,
        subject: `${group.count} lead${group.count > 1 ? "s" : ""} haven't been contacted in 7+ days`,
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
            <h2 style="color:#dc2626;">Lead Aging Alert</h2>
            <p>You have <strong>${group.count} lead${group.count > 1 ? "s" : ""}</strong> that ${group.count > 1 ? "have" : "has"} not been contacted in over 7 days.</p>
            <p>Don't let warm leads go cold. Log in to CoveCRM and follow up today.</p>
            <a href="https://covecrm.com/dashboard?tab=leads" style="display:inline-block;background:#6366f1;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;margin-top:12px;">
              View Leads
            </a>
          </div>
        `,
      });
      emailsSent++;
    } catch (err: any) {
      console.warn("[aging-alerts] Email error for", userEmail, err?.message);
    }
  }

  return res.status(200).json({ ok: true, emailsSent, usersWithStaleLeads: staleLeads.length });
}

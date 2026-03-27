// pages/api/team/invite.ts
// POST — send a team invite to an email address
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import TeamInvite from "@/models/TeamInvite";
import crypto from "crypto";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  await mongooseConnect();

  const ownerEmail = session.user.email.toLowerCase();
  const { inviteeEmail } = req.body as { inviteeEmail?: string };

  if (!inviteeEmail) return res.status(400).json({ error: "inviteeEmail required" });

  // Generate a secure token
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Upsert invite
  await TeamInvite.findOneAndUpdate(
    { ownerEmail, inviteeEmail: inviteeEmail.toLowerCase() },
    {
      $set: {
        tokenHash,
        status: "pending",
        expiresAt,
      },
    },
    { upsert: true }
  );

  const acceptUrl = `${process.env.NEXTAUTH_URL}/team/accept?token=${rawToken}&owner=${encodeURIComponent(ownerEmail)}`;

  try {
    await resend.emails.send({
      from: "CoveCRM <team@covecrm.com>",
      to: inviteeEmail,
      subject: `${session.user.name || ownerEmail} invited you to their CoveCRM team`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px;">
          <h2>You've been invited!</h2>
          <p>${session.user.name || ownerEmail} has invited you to join their team on CoveCRM.</p>
          <a href="${acceptUrl}" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;margin-top:16px;">
            Accept Invitation
          </a>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px;">This invite expires in 7 days.</p>
        </div>
      `,
    });
  } catch (err: any) {
    console.warn("[team-invite] Email send failed:", err?.message);
  }

  return res.status(200).json({ ok: true });
}

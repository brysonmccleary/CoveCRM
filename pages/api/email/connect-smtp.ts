// pages/api/email/connect-smtp.ts
// Agent submits their SMTP credentials; we verify by sending a test email,
// then save the account with AES-256 encrypted password.
const nodemailer = require("nodemailer") as any;

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import AgentEmailAccount from "@/models/AgentEmailAccount";
import { encrypt } from "@/lib/prospecting/encrypt";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const session = (await getServerSession(req, res, authOptions as any)) as any;
  if (!session?.user?.email) return res.status(401).json({ error: "Unauthorized" });

  const userEmail = String(session.user.email).toLowerCase();
  await mongooseConnect();

  // ── DELETE: deactivate the agent's SMTP account ──────────────────────────
  if (req.method === "DELETE") {
    const user = await User.findOne({ email: userEmail }).select("_id").lean();
    if (!user?._id) return res.status(404).json({ error: "User not found" });

    await AgentEmailAccount.updateOne(
      { userId: user._id },
      { $set: { active: false } }
    );
    return res.status(200).json({ ok: true });
  }

  // ── POST: connect / update SMTP ──────────────────────────────────────────
  const { fromName, fromEmail, smtpHost, smtpPort, smtpUser, smtpPass, smtpSecure } =
    req.body || {};

  if (!fromName || !fromEmail || !smtpHost || !smtpPort || !smtpUser || !smtpPass) {
    return res.status(400).json({
      error: "fromName, fromEmail, smtpHost, smtpPort, smtpUser, and smtpPass are required",
    });
  }

  const user = await User.findOne({ email: userEmail }).select("_id").lean();
  if (!user?._id) return res.status(404).json({ error: "User not found" });

  // Verify SMTP by sending a test email to their own address
  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: smtpSecure === true || smtpSecure === "true",
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 10000,
    });

    await transporter.verify();

    await transporter.sendMail({
      from: `${fromName} <${fromEmail}>`,
      to: fromEmail,
      subject: "CoveCRM SMTP Connection Verified",
      html: "<p>Your SMTP account has been successfully connected to CoveCRM.</p>",
    });
  } catch (err: any) {
    console.warn("[connect-smtp] Verification failed:", err?.message);
    return res.status(400).json({
      ok: false,
      error: "Could not connect. Check your credentials.",
    });
  }

  // Encrypt password
  let encryptedPass: string;
  try {
    encryptedPass = encrypt(smtpPass);
  } catch {
    return res
      .status(500)
      .json({ ok: false, error: "Encryption not configured (ENCRYPTION_KEY missing)" });
  }

  // Upsert — one active account per user
  await AgentEmailAccount.findOneAndUpdate(
    { userId: user._id },
    {
      $set: {
        userId: user._id,
        userEmail,
        fromName,
        fromEmail,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser,
        smtpPass: encryptedPass,
        smtpSecure: smtpSecure === true || smtpSecure === "true",
        isVerified: true,
        verifiedAt: new Date(),
        active: true,
      },
    },
    { upsert: true, new: true }
  );

  return res.status(200).json({ ok: true, fromEmail });
}

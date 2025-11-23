// /pages/api/auth/request-password-reset.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PasswordResetToken from "@/models/PasswordResetToken";
import { sendPasswordResetEmail } from "@/lib/email";

const getBaseUrl = () => {
  // Prefer explicit envs, then NEXTAUTH_URL, then hard default to production URL
  const raw =
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.NODE_ENV === "development"
      ? "http://localhost:3000"
      : "https://www.covecrm.com");

  // Strip trailing slash if present
  return raw.replace(/\/$/, "");
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { email } = (req.body || {}) as { email?: string };

  if (!email || typeof email !== "string") {
    return res.status(400).json({ ok: false, error: "Email required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    await mongooseConnect();

    console.info("[password-reset] Incoming reset request", {
      email: normalizedEmail,
    });

    // Always respond success (don’t leak which emails exist)
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      console.info("[password-reset] No user found for email (returning ok)", {
        email: normalizedEmail,
      });
      return res.status(200).json({ ok: true });
    }

    // Invalidate any previous tokens for this user
    await PasswordResetToken.deleteMany({ userEmail: normalizedEmail });

    // Create a new token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await PasswordResetToken.create({
      userEmail: normalizedEmail,
      tokenHash,
      expiresAt,
    });

    const baseUrl = getBaseUrl();
    const resetUrl = `${baseUrl}/auth/reset/${encodeURIComponent(rawToken)}`;

    console.info("[password-reset] Created token + resetUrl", {
      email: normalizedEmail,
      resetUrl,
      expiresAt: expiresAt.toISOString(),
    });

    const emailResult = await sendPasswordResetEmail({
      to: normalizedEmail,
      resetUrl,
    });

    if (!emailResult.ok) {
      console.error("[password-reset] sendPasswordResetEmail failed", {
        email: normalizedEmail,
        error: emailResult.error,
      });
      // Still don't leak error to client
      return res.status(200).json({ ok: true, emailed: false });
    }

    console.info("[password-reset] Password reset email sent", {
      email: normalizedEmail,
      messageId: emailResult.id,
    });

    return res.status(200).json({ ok: true, emailed: true });
  } catch (err: any) {
    console.error("[password-reset] Unexpected error", {
      error: err?.message || String(err),
      stack: err?.stack,
    });
    // Don't leak details to client
    return res.status(200).json({ ok: true });
  }
}

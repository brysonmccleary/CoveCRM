// /pages/api/auth/request-password-reset.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import bcrypt from "bcrypt";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PasswordResetToken from "@/models/PasswordResetToken";
import { sendPasswordResetEmail } from "@/lib/email";

const getBaseUrl = () => {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    process.env.NEXTAUTH_URL ||
    (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "")
  );
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { email } = (req.body || {}) as { email?: string };
  if (!email) return res.status(400).json({ ok: false, error: "Email required" });

  await mongooseConnect();

  // Always respond success (don’t leak which emails exist)
  const user = await User.findOne({ email });

  if (user) {
    // Invalidate any previous tokens for this user (optional hardening)
    await PasswordResetToken.deleteMany({ userEmail: email });

    // Create a new token
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour

    await PasswordResetToken.create({
      userEmail: email,
      tokenHash,
      expiresAt,
    });

    const resetUrl = `${getBaseUrl()}/auth/reset/${rawToken}`;
    await sendPasswordResetEmail({
      to: email,
      resetUrl,
    }).catch((e) => {
      // Log but don't reveal to client
      console.error("sendPasswordResetEmail error:", e?.message || e);
    });
  }

  return res.status(200).json({ ok: true });
}

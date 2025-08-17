// /pages/api/auth/reset-password.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import bcrypt from "bcrypt";
import mongooseConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import PasswordResetToken from "@/models/PasswordResetToken";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const { token, newPassword } = (req.body || {}) as { token?: string; newPassword?: string };

  if (!token || !newPassword) return res.status(400).json({ ok: false, error: "Missing fields" });
  if (String(newPassword).length < 8) return res.status(400).json({ ok: false, error: "Password too short" });

  await mongooseConnect();

  const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
  const now = new Date();

  const record = await PasswordResetToken.findOne({ tokenHash, usedAt: { $exists: false }, expiresAt: { $gte: now } });
  if (!record) return res.status(400).json({ ok: false, error: "Invalid or expired token" });

  const user = await User.findOne({ email: record.userEmail });
  if (!user) return res.status(400).json({ ok: false, error: "Invalid token" });

  const hashed = await bcrypt.hash(String(newPassword), 10);
  user.password = hashed;
  await user.save();

  // Mark this token used and purge any other outstanding tokens for this user
  record.usedAt = new Date();
  await record.save();
  await PasswordResetToken.deleteMany({ userEmail: record.userEmail, _id: { $ne: record._id } });

  return res.status(200).json({ ok: true });
}

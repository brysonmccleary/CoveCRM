import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import bcrypt from "bcryptjs";
import { z } from "zod";

/** Exported for unit tests */
export const RegisterSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  email: z.string().email("Valid email required").max(320),
  password: z.string().min(8, "Password must be at least 8 characters"),
  // confirmPassword stays OPTIONAL for backward compatibility with any legacy callers.
  // If provided, it must match password.
  confirmPassword: z
    .string()
    .optional()
    .refine(() => true, "noop"), // placeholder so .superRefine always runs
  usedCode: z.string().optional(),
  affiliateEmail: z.string().email().optional(),
}).superRefine((val, ctx) => {
  if (typeof val.confirmPassword === "string" && val.confirmPassword !== val.password) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["confirmPassword"],
      message: "Passwords do not match.",
    });
  }
});

/** Admin allow-list (comma-separated emails in Vercel env) */
function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    if (mongoose.connection.readyState === 0) {
      await dbConnect();
    }

    // Zod parse with clean 400s
    const parsed = RegisterSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(400).json({ message: first?.message || "Invalid request" });
    }
    const { name, email, password, usedCode, affiliateEmail } = parsed.data;

    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    // Ensure not already registered
    const existing = await User.findOne({ email: cleanEmail }).lean();
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    // Hash password
    const hashed = await bcrypt.hash(password, 10);

    // Admins get role=admin and skip billing everywhere (handled by trackUsage/shouldBill)
    const admin = isAdminEmail(cleanEmail);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashed,
      role: admin ? "admin" : "user",
      plan: admin ? "Pro" : "Free", // label only; no charges for admins
      subscriptionStatus: "active",
      referredBy: affiliateEmail || undefined,
    });

    // Optional: record promo code used (display/analytics only)
    if (usedCode) {
      await User.updateOne(
        { _id: user._id },
        { $set: { referralCode: (usedCode || "").toUpperCase() } },
      );
    }

    return res.status(200).json({ ok: true, admin });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

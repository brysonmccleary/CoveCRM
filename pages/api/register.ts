// /pages/api/register.ts
import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import bcrypt from "bcryptjs";

/** Admin allow-list (comma-separated emails in Vercel env) */
function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    if (mongoose.connection.readyState === 0) {
      await dbConnect();
    }

    const { name, email, password, usedCode, affiliateEmail } = (req.body || {}) as {
      name?: string;
      email?: string;
      password?: string;
      usedCode?: string;
      affiliateEmail?: string;
    };

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();
    const pw = String(password || "");

    if (!cleanName || !cleanEmail || !pw) {
      return res.status(400).json({ message: "Missing name, email, or password" });
    }

    // Ensure not already registered
    const existing = await User.findOne({ email: cleanEmail }).lean();
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    // Hash password
    const hashed = await bcrypt.hash(pw, 10);

    // Admins get role=admin and skip billing everywhere (handled by trackUsage/shouldBill)
    const admin = isAdminEmail(cleanEmail);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashed,
      role: admin ? "admin" : "user",
      // sensible defaults already exist in your schema; set a couple explicitly:
      plan: admin ? "Pro" : "Free",        // label only; no charges for admins
      subscriptionStatus: "active",
      referredBy: affiliateEmail || undefined,
    });

    // Optional: record promo code used (display/analytics only)
    if (usedCode) {
      await User.updateOne({ _id: user._id }, { $set: { referralCode: (usedCode || "").toUpperCase() } });
    }

    // Done — client decides whether to go to billing. For admins we recommend skipping billing UI.
    return res.status(200).json({ ok: true, admin });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

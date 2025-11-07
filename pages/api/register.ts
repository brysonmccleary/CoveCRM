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

/** Create a unique personal referral code for the new user */
async function generateUniqueReferralCode(baseName: string) {
  const base =
    (baseName || "USER")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(0, 8)
      .toUpperCase() || "USER";

  // Try base + random suffix until unique
  for (let i = 0; i < 20; i++) {
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const code = `${base}${suffix}`;
    const exists = await User.exists({ referralCode: code });
    if (!exists) return code;
  }
  // Fallback
  return `USER${Date.now().toString(36).toUpperCase()}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    if (mongoose.connection.readyState === 0) {
      await dbConnect();
    }

    const {
      name,
      email,
      password,
      usedCode,        // promo/referral code user entered (optional)
      affiliateEmail,  // optional explicit affiliate email (admin usage / manual attributions)
    } = (req.body || {}) as {
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

    // Identify referrer (by code first, then by affiliateEmail)
    let referredById: mongoose.Types.ObjectId | undefined = undefined;
    let appliedReferralCode: string | undefined = undefined;

    const code = (usedCode || "").trim().toUpperCase();
    if (code) {
      const refUser = await User.findOne({ referralCode: code }, { _id: 1 }).lean();
      if (refUser?._id) {
        referredById = refUser._id as unknown as mongoose.Types.ObjectId;
        appliedReferralCode = code;
      }
    }
    if (!referredById && affiliateEmail) {
      const refByEmail = await User.findOne(
        { email: affiliateEmail.trim().toLowerCase() },
        { _id: 1, referralCode: 1 }
      ).lean();
      if (refByEmail?._id) {
        referredById = refByEmail._id as unknown as mongoose.Types.ObjectId;
        appliedReferralCode = appliedReferralCode || refByEmail.referralCode;
      }
    }

    // Hash password
    const hashed = await bcrypt.hash(pw, 10);

    // Admins get role=admin and skip billing everywhere (handled by trackUsage/shouldBill)
    const admin = isAdminEmail(cleanEmail);

    // Give every new user their *own* unique personal referralCode (for sharing)
    const personalReferralCode = await generateUniqueReferralCode(cleanName);

    const user = await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashed,
      role: admin ? "admin" : "user",
      plan: admin ? "Pro" : "Free",
      subscriptionStatus: "active",
      referralCode: personalReferralCode,     // unique per-user
      referredBy: referredById,               // attribution (ObjectId)
      appliedReferralCode,                    // the code they actually typed (non-unique)
    });

    // Done
    return res.status(200).json({
      ok: true,
      admin,
      userId: user._id,
      referralCode: personalReferralCode,
      redirect: "/dashboard",
    });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

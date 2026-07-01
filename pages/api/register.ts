import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { enforceRateLimit } from "@/lib/rateLimit";

/** Stripe */
import Stripe from "stripe";
import { assertStripeWritesEnabled } from "@/lib/billing/assertStripeWritesEnabled";
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const STRIPE_MODE: "live" | "test" | undefined = stripeKey
  ? (stripeKey.startsWith("sk_live_") ? "live" : "test")
  : undefined;

import { sendEmailVerificationCode, sendWelcomeEmail } from "@/lib/email"; // ✅ NEW

/** Admin allow-list (comma-separated emails in Vercel env) */
function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HOUSE_CODES = new Set(
  (process.env.HOUSE_CODES || "COVE50")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
);

function makeVerificationCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashVerificationCode(email: string, code: string) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.NEXTAUTH_SECRET || "covecrm";
  return crypto
    .createHmac("sha256", secret)
    .update(`${email.toLowerCase()}:${code}`)
    .digest("hex");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function makeEmailVerificationToken(email: string, expiresAt: Date) {
  const secret = process.env.EMAIL_VERIFICATION_SECRET || process.env.NEXTAUTH_SECRET || "covecrm";
  const payload = base64UrlEncode(JSON.stringify({
    email: email.toLowerCase(),
    expiresAt: expiresAt.toISOString(),
  }));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${payload}.${signature}`;
}

async function generateUniqueReferralCode(): Promise<string> {
  const ALPHANUM = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const make = () =>
    Array.from({ length: 6 }, () => ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)]).join("");
  for (let i = 0; i < 6; i++) {
    const code = make();
    const exists = await User.findOne({ referralCode: code }).lean();
    if (!exists) return code;
  }
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  const cleanEmailForLimit = String((req.body || {}).email || "").trim().toLowerCase();
  if (
    !enforceRateLimit(req, res, {
      keyPrefix: "auth:register",
      subject: cleanEmailForLimit,
      limit: 5,
      windowMs: 60 * 60 * 1000,
    })
  ) {
    return;
  }

  try {
    if (mongoose.connection.readyState === 0) {
      await dbConnect();
    }

    const { name, email, password, confirmPassword, usedCode, plan, interval, ref } = (req.body || {}) as {
      name?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
      usedCode?: string; // optional
      plan?: string;
      interval?: string;
      ref?: string;
    };

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();
    // Derive first/last name for Settings → Profile (so AI always has agent name)
    // Example: "First Last" => firstName="First", lastName="Last"
    const _nameParts = cleanName.split(/\s+/).filter(Boolean);
    const firstName = String(_nameParts[0] || "").slice(0, 40);
    const lastName = String(_nameParts.slice(1).join(" ") || "").slice(0, 60);

    const pw = String(password || "");
    const confirmPw = confirmPassword !== undefined ? String(confirmPassword) : undefined;

    if (!cleanName || !cleanEmail || !pw) {
      return res.status(400).json({ message: "Missing name, email, or password" });
    }
    if (confirmPw !== undefined && confirmPw !== pw) {
      return res.status(400).json({ message: "Passwords do not match" });
    }

    const existing = await User.findOne({ email: cleanEmail }).lean();
    if (existing) {
      return res.status(409).json({ message: "Email already registered" });
    }

    // Referral context (do not write legacy referredBy)
    let referredByCode: string | undefined;
    let referredByUserId: any | undefined;
    let isHouse = false;

    const codeInputRaw = (usedCode ?? "").trim();
    if (codeInputRaw) {
      const codeInput = codeInputRaw.toUpperCase();
      isHouse = HOUSE_CODES.has(codeInput.toLowerCase());

      const affiliateOwner = await User.findOne({
        affiliateCode: new RegExp(`^${escapeRegex(codeInput)}$`, "i"),
        affiliateApproved: true,
      })
        .select({ _id: 1, affiliateCode: 1 })
        .lean();

      if (!affiliateOwner && !isHouse) {
        // Allow unknown codes so Stripe promo codes or future affiliate codes don't block signup
        // If it isn't an approved affiliate, we simply don't attach referral tracking
      }

      referredByCode = codeInput;
      referredByUserId = affiliateOwner ? affiliateOwner._id : undefined;
    }

    const hashed = await bcrypt.hash(pw, 10);
    if (!hashed) return res.status(500).json({ message: "Password could not be secured" });
    const admin = isAdminEmail(cleanEmail);
    const myReferralCode = await generateUniqueReferralCode();
    const selectedPlanCode = plan === "ai" ? "ai" : "base";
    const selectedBillingInterval = interval === "annual" ? "annual" : "monthly";
    const affiliateReferralCode = String(ref || "").trim() || null;
    const trialStartedAt = new Date();
    const trialEndsAt = new Date(trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const effectivePlanCode = admin ? "free" : selectedPlanCode;
    const effectiveHasAI = admin || effectivePlanCode === "ai";
    const aiEntitlementSource =
      effectivePlanCode === "ai" ? "plan" : effectivePlanCode === "free" ? "legacy" : "none";
    const verificationCode = makeVerificationCode();
    const verificationCodeHash = hashVerificationCode(cleanEmail, verificationCode);
    const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const verificationToken = makeEmailVerificationToken(cleanEmail, verificationExpiresAt);
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://www.covecrm.com";
    const verifyUrl = `${baseUrl}/api/auth/verify-email?email=${encodeURIComponent(
      cleanEmail,
    )}&token=${encodeURIComponent(verificationToken)}`;

    // Create Stripe customer (metadata only). Discount is applied later at checkout/subscription.
    let stripeCustomerId: string | undefined;
    try {
      if (stripe) {
        assertStripeWritesEnabled();
        const customer = await stripe.customers.create({
          email: cleanEmail,
          name: cleanName,
          metadata: {
            agentFirstName: firstName,
            agentLastName: lastName,
            usedCode: codeInputRaw || "",
            selectedPlanCode,
            selectedBillingInterval,
            affiliateReferralCode: affiliateReferralCode || "",
            isHouseCode: String(isHouse),
            referredByUserId: referredByUserId ? String(referredByUserId) : "",
            source: "covecrm-register",
            stripeMode: STRIPE_MODE || "",
          },
        });
        stripeCustomerId = customer.id;
      }
    } catch (e: any) {
      console.error("[/api/register] Stripe customer create failed:", e?.message || e);
      // Non-fatal: proceed; subscription API will create customer if missing.
    }

    const newUser = await User.create({
      name: cleanName,
      firstName,
      lastName,
      email: cleanEmail,
      password: hashed,
      role: admin ? "admin" : "user",
      plan: admin ? "Pro" : "Free",
      planCode: effectivePlanCode,
      billingInterval: selectedBillingInterval,
      subscriptionStatus: admin ? "active" : "pending",
      hasAI: effectiveHasAI,
      aiEntitlementSource,
      emailVerified: admin,
      emailVerificationCodeHash: admin ? null : verificationCodeHash,
      emailVerificationExpiresAt: admin ? null : verificationExpiresAt,
      trialGranted: admin,
      trialActivatedAt: admin ? new Date() : null,
      trialStartedAt,
      trialEndsAt,
      cardOnFile: false,
      trialEmailUsed: admin,
      trialBlockedReason: null,
      referralCode: myReferralCode,
      referredByCode,
      referredByUserId,
      affiliateReferralCode,
      affiliateId: null,
      stripeCustomerId,
      usedCode: codeInputRaw || undefined,
      isHouseCode: isHouse,
    });

    if (affiliateReferralCode) {
      void (async () => {
        try {
          const affiliate = await Affiliate.findOne({
            referralCode: affiliateReferralCode,
            approved: true,
          })
            .select({ _id: 1 })
            .lean() as any;

          if (!affiliate?._id) return;

          await User.updateOne(
            { _id: newUser._id },
            { $set: { affiliateId: affiliate._id } },
          );
          await Affiliate.updateOne(
            { _id: affiliate._id },
            {
              $push: {
                referredUsers: {
                  userId: newUser._id,
                  joinedAt: new Date(),
                  planCode: effectivePlanCode,
                  billingInterval: selectedBillingInterval,
                  isActive: true,
                  lastPayoutAt: null,
                  totalPayoutsSentToAffiliate: 0,
                },
              },
            },
          );
        } catch (e: any) {
          console.warn("[/api/register] async affiliate referral lookup failed:", e?.message || e);
        }
      })();
    }

    try {
      if (!admin) {
        const sent = await sendEmailVerificationCode({
          to: newUser.email,
          name: newUser.name,
          code: verificationCode,
          verifyUrl,
        });
        if (!sent.ok) throw new Error(sent.error || "Verification email failed");
      }
      await sendWelcomeEmail({ to: newUser.email, name: newUser.name });
    } catch (e: any) {
      console.error("verification/welcome email (register) failed:", e?.message || e);
      return res.status(500).json({
        message: "Account created, but verification email could not be sent. Please request a new code.",
      });
    }

    return res.status(200).json({
      ok: true,
      admin,
      referralCode: myReferralCode,
      isHouse,
      // registration no longer attaches discounts at customer level:
      appliedDiscount: false,
      appliedVia: null,
      stripeLinked: Boolean(stripeCustomerId),
      stripeMode: STRIPE_MODE,
    });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

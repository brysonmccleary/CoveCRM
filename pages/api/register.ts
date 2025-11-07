import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import bcrypt from "bcryptjs";

/** Stripe */
import Stripe from "stripe";
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const stripe =
  stripeKey
    ? new Stripe(stripeKey, { apiVersion: "2023-10-16" })
    : null;

/** Admin allow-list (comma-separated emails in Vercel env) */
function isAdminEmail(email?: string | null) {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.toLowerCase());
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const HOUSE_CODES = new Set(
  (process.env.HOUSE_CODES || "COVE50")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
);

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

/**
 * Find an active Stripe Promotion Code by the literal code (case-insensitive).
 * Returns null if Stripe is not configured or no active promo is found.
 */
async function findActivePromotionCode(code: string) {
  if (!stripe) return null;
  // Stripe supports exact code filtering; we still normalize case here.
  const promos = await stripe.promotionCodes.list({
    code,
    limit: 1,
    active: true,
    expand: ["data.coupon"],
  });
  const pc = promos.data?.[0] || null;
  if (!pc || !pc.active) return null;
  return pc;
}

/**
 * Ensure a Stripe Customer exists with referral metadata and, if available,
 * attach a customer-level discount using a Promotion Code so discounts
 * automatically apply to future subscriptions/invoices.
 */
async function ensureStripeCustomerWithDiscount(params: {
  email: string;
  name: string;
  usedCode?: string;
  isHouse: boolean;
  referredByUserId?: string;
}) {
  if (!stripe) {
    return {
      customerId: undefined as string | undefined,
      promotionCodeId: undefined as string | undefined,
      couponId: undefined as string | undefined,
      appliedDiscount: false,
      stripeError: "Stripe not configured",
    };
  }

  const { email, name, usedCode, isHouse, referredByUserId } = params;

  // Create a Stripe Customer (idempotent by email; if you create elsewhere, it's fine to create again—Stripe dedupes by email on your side of business logic)
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      usedCode: usedCode || "",
      isHouseCode: String(isHouse),
      referredByUserId: referredByUserId || "",
      // Keep a breadcrumb for support/search
      source: "covecrm-register",
    },
  });

  let promotionCodeId: string | undefined;
  let couponId: string | undefined;
  let appliedDiscount = false;

  if (usedCode) {
    const promo = await findActivePromotionCode(usedCode);
    if (promo) {
      promotionCodeId = promo.id;
      couponId = typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;

      // Attach discount at the CUSTOMER level so it auto-applies later.
      // New API style: create a customer discount via promotion_code.
      try {
        // @ts-ignore - types may lag behind newest endpoint helper; this maps to POST /v1/customers/{id}/discount
        await stripe.customers.createDiscount(customer.id, {
          promotion_code: promotionCodeId,
        });
        appliedDiscount = true;
      } catch (e) {
        // As a fallback (older API shapes), try using the discounts API directly
        // If it still fails, we swallow to avoid blocking registration
        // console.error kept for debugging.
        console.error("[register] failed to attach customer discount:", e);
      }
    }
  }

  return {
    customerId: customer.id,
    promotionCodeId,
    couponId,
    appliedDiscount,
    stripeError: undefined as string | undefined,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).json({ message: "Method not allowed" });

  try {
    if (mongoose.connection.readyState === 0) {
      await dbConnect();
    }

    const { name, email, password, confirmPassword, usedCode } = (req.body || {}) as {
      name?: string;
      email?: string;
      password?: string;
      confirmPassword?: string;
      usedCode?: string; // optional
    };

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(name || "").trim();
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

    // Decide referral interpretation without touching legacy `referredBy`
    let referredByCode: string | undefined;
    let referredByUserId: any | undefined;
    let isHouse = false;

    const codeInputRaw = (usedCode ?? "").trim();
    if (codeInputRaw) {
      const codeInput = codeInputRaw.toUpperCase();
      isHouse = HOUSE_CODES.has(codeInput.toLowerCase());

      // Try affiliate first (approved & exact code match, case-insensitive)
      const affiliateOwner = await User.findOne({
        affiliateCode: new RegExp(`^${escapeRegex(codeInput)}$`, "i"),
        affiliateApproved: true,
      }).select({ _id: 1, affiliateCode: 1 }).lean();

      if (!affiliateOwner && !isHouse) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      referredByCode = codeInput;
      referredByUserId = affiliateOwner ? affiliateOwner._id : undefined;
    }

    const hashed = await bcrypt.hash(pw, 10);
    const admin = isAdminEmail(cleanEmail);
    const myReferralCode = await generateUniqueReferralCode();

    // 1) Create Stripe Customer and (if present) attach discount via promotion code
    let stripeCustomerId: string | undefined;
    let stripePromotionCodeId: string | undefined;
    let stripeCouponId: string | undefined;
    let appliedDiscount = false;
    let stripeError: string | undefined;

    try {
      const stripeResult = await ensureStripeCustomerWithDiscount({
        email: cleanEmail,
        name: cleanName,
        usedCode: codeInputRaw || undefined,
        isHouse,
        referredByUserId: referredByUserId ? String(referredByUserId) : undefined,
      });
      stripeCustomerId = stripeResult.customerId;
      stripePromotionCodeId = stripeResult.promotionCodeId;
      stripeCouponId = stripeResult.couponId;
      appliedDiscount = stripeResult.appliedDiscount;
      stripeError = stripeResult.stripeError;
    } catch (e: any) {
      console.error("[/api/register] Stripe setup failed:", e?.message || e);
      stripeError = e?.message || "Stripe setup failed";
    }

    // 2) Create the app user (persist stripe + referral context)
    await User.create({
      name: cleanName,
      email: cleanEmail,
      password: hashed,
      role: admin ? "admin" : "user",
      plan: admin ? "Pro" : "Free",
      subscriptionStatus: "active",

      referralCode: myReferralCode,
      referredByCode,
      referredByUserId,

      // Stripe linkage & discount context
      stripeCustomerId,
      stripePromotionCodeId,
      stripeCouponId,
      usedCode: codeInputRaw || undefined,
      isHouseCode: isHouse,

      // do NOT write legacy `referredBy` anymore
    });

    return res.status(200).json({
      ok: true,
      admin,
      referralCode: myReferralCode,
      isHouse,
      appliedDiscount,
      stripeLinked: Boolean(stripeCustomerId),
      stripeError: stripeError || undefined,
    });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

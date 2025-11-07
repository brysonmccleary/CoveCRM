import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import bcrypt from "bcryptjs";

/** Stripe */
import Stripe from "stripe";
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
// Do not pin apiVersion to avoid TS mismatches with installed typings
const stripe = stripeKey ? new Stripe(stripeKey) : null;

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

/** Look up an active Promotion Code by its literal code (case-insensitive). */
async function findActivePromotionCode(code: string) {
  if (!stripe) return null;
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
 * Fallback: find a Coupon by ID==code or by Name==code (case-insensitive).
 * Stripe doesn't support searching by name server-side, so we scan the first page.
 */
async function findCouponByCodeOrName(code: string) {
  if (!stripe) return null;

  // 1) Try coupon id = code (common when codes are created as coupon ids)
  try {
    const byId = await stripe.coupons.retrieve(code);
    if (byId && (byId as any).id) return byId;
  } catch {
    // ignore 404
  }

  // 2) Scan a page of coupons and match by name (case-insensitive).
  // Limit 100 is a reasonable single page; adjust later if you have >100.
  const page = await stripe.coupons.list({ limit: 100 });
  const match = page.data.find((c) => {
    const nm = (c.name || "").trim().toLowerCase();
    return nm && nm === code.trim().toLowerCase();
  });
  return match || null;
}

/**
 * Create Stripe Customer and attach a discount:
 * 1) Prefer promotion_code.
 * 2) Fallback to coupon (by id==code or name==code).
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
      appliedVia: undefined as "promotion_code" | "coupon" | undefined,
      stripeError: "Stripe not configured",
    };
  }

  const { email, name, usedCode, isHouse, referredByUserId } = params;

  const customer = await stripe.customers.create({
    email,
    name,
    metadata: {
      usedCode: usedCode || "",
      isHouseCode: String(isHouse),
      referredByUserId: referredByUserId || "",
      source: "covecrm-register",
    },
  });

  let promotionCodeId: string | undefined;
  let couponId: string | undefined;
  let appliedDiscount = false;
  let appliedVia: "promotion_code" | "coupon" | undefined;

  if (usedCode) {
    // Try promotion code first
    const promo = await findActivePromotionCode(usedCode);
    if (promo) {
      promotionCodeId = promo.id;
      couponId = typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;

      try {
        // @ts-ignore: helper exists even if typings lag
        await stripe.customers.createDiscount(customer.id, {
          promotion_code: promotionCodeId,
        });
        appliedDiscount = true;
        appliedVia = "promotion_code";
      } catch (e) {
        console.error("[register] attach discount via promotion_code failed:", e);
      }
    }

    // Fallback to coupon if no promo attached
    if (!appliedDiscount) {
      const coupon = await findCouponByCodeOrName(usedCode);
      if (coupon && coupon.id) {
        couponId = coupon.id;
        try {
          // @ts-ignore: createDiscount accepts `coupon` as well
          await stripe.customers.createDiscount(customer.id, {
            coupon: coupon.id,
          });
          appliedDiscount = true;
          appliedVia = "coupon";
        } catch (e) {
          console.error("[register] attach discount via coupon failed:", e);
        }
      }
    }
  }

  return {
    customerId: customer.id,
    promotionCodeId,
    couponId,
    appliedDiscount,
    appliedVia,
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
      })
        .select({ _id: 1, affiliateCode: 1 })
        .lean();

      if (!affiliateOwner && !isHouse) {
        return res.status(400).json({ message: "Invalid referral code" });
      }

      referredByCode = codeInput;
      referredByUserId = affiliateOwner ? affiliateOwner._id : undefined;
    }

    const hashed = await bcrypt.hash(pw, 10);
    const admin = isAdminEmail(cleanEmail);
    const myReferralCode = await generateUniqueReferralCode();

    // 1) Create Stripe Customer and attach discount (promo preferred, coupon fallback)
    let stripeCustomerId: string | undefined;
    let stripePromotionCodeId: string | undefined;
    let stripeCouponId: string | undefined;
    let appliedDiscount = false;
    let appliedVia: "promotion_code" | "coupon" | undefined;
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
      appliedVia = stripeResult.appliedVia;
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
    });

    return res.status(200).json({
      ok: true,
      admin,
      referralCode: myReferralCode,
      isHouse,
      appliedDiscount,
      appliedVia,
      stripeLinked: Boolean(stripeCustomerId),
      stripeError: stripeError || undefined,
    });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

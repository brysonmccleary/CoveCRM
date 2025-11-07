import type { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import bcrypt from "bcryptjs";

/** Stripe */
import Stripe from "stripe";
const stripeKey = process.env.STRIPE_SECRET_KEY || "";
const stripe = stripeKey ? new Stripe(stripeKey) : null;
const STRIPE_MODE: "live" | "test" | undefined = stripeKey
  ? (stripeKey.startsWith("sk_live_") ? "live" : "test")
  : undefined;

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

/* ---------- Stripe lookups (robust) ---------- */

/** Case-insensitive promotion code lookup. */
async function findPromotionCodeInsensitive(code: string) {
  if (!stripe) return null;

  // 1) First try direct (exact) filter – fastest
  try {
    const exact = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
      expand: ["data.coupon"],
    });
    if (exact.data?.[0]) return exact.data[0];
  } catch {}

  // 2) Fallback: scan first page and match .code case-insensitively
  const page = await stripe.promotionCodes.list({
    active: true,
    limit: 100,
    expand: ["data.coupon"],
  });
  const lc = code.trim().toLowerCase();
  const found = page.data.find((p) => (p.code || "").trim().toLowerCase() === lc);
  return found || null;
}

/** Find a coupon by id==code or name==code (case-insensitive). */
async function findCouponByIdOrName(code: string) {
  if (!stripe) return null;

  // Try by ID
  try {
    const byId = await stripe.coupons.retrieve(code);
    if (byId && (byId as any).id) return byId;
  } catch {}

  // Scan page by name (case-insensitive)
  const page = await stripe.coupons.list({ limit: 100 });
  const lc = code.trim().toLowerCase();
  const found = page.data.find((c) => (c.name || "").trim().toLowerCase() === lc);
  return found || null;
}

/** Attach discount to a customer; prefer promotion_code, fallback to coupon. */
async function attachCustomerDiscount(opts: {
  customerId: string;
  promotionCodeId?: string;
  couponId?: string;
}): Promise<{ ok: boolean; via?: "promotion_code" | "coupon" }> {
  if (!stripe) return { ok: false };

  const { customerId, promotionCodeId, couponId } = opts;

  // Helper: try createDiscount, then fallback to update
  async function tryAttach(kind: "promotion_code" | "coupon", value: string) {
    try {
      // @ts-ignore newer helper
      await stripe.customers.createDiscount(customerId, { [kind]: value });
      return true;
    } catch (e) {
      // fallback – some SDK versions support setting via update()
      try {
        // @ts-ignore allow untyped props on update
        await stripe.customers.update(customerId, { [kind]: value });
        return true;
      } catch (e2) {
        console.error(`[register] attach ${kind} failed:`, e2);
        return false;
      }
    }
  }

  if (promotionCodeId) {
    const ok = await tryAttach("promotion_code", promotionCodeId);
    if (ok) return { ok: true, via: "promotion_code" };
  }
  if (couponId) {
    const ok = await tryAttach("coupon", couponId);
    if (ok) return { ok: true, via: "coupon" };
  }
  return { ok: false };
}

/* ---------- Stripe customer creation + discount logic ---------- */

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
      stripeMode: STRIPE_MODE || "",
    },
  });

  let promotionCodeId: string | undefined;
  let couponId: string | undefined;
  let appliedDiscount = false;
  let appliedVia: "promotion_code" | "coupon" | undefined;

  if (usedCode) {
    const promo = await findPromotionCodeInsensitive(usedCode);
    if (promo) {
      promotionCodeId = promo.id;
      couponId = typeof promo.coupon === "string" ? promo.coupon : promo.coupon?.id;
    } else {
      const coupon = await findCouponByIdOrName(usedCode);
      if (coupon) couponId = coupon.id;
    }

    if (promotionCodeId || couponId) {
      const attach = await attachCustomerDiscount({
        customerId: customer.id,
        promotionCodeId,
        couponId,
      });
      appliedDiscount = attach.ok;
      appliedVia = attach.via;
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

/* --------------------------- API handler --------------------------- */

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
        return res.status(400).json({ message: "Invalid referral code" });
      }

      referredByCode = codeInput;
      referredByUserId = affiliateOwner ? affiliateOwner._id : undefined;
    }

    const hashed = await bcrypt.hash(pw, 10);
    const admin = isAdminEmail(cleanEmail);
    const myReferralCode = await generateUniqueReferralCode();

    // Stripe customer + discount (robust)
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
      stripeMode: STRIPE_MODE,
      stripeError: stripeError || undefined,
    });
  } catch (err: any) {
    console.error("[/api/register] error:", err);
    return res.status(500).json({ message: err?.message || "Server error" });
  }
}

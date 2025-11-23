// /pages/api/affiliate/apply.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import User from "@/models/User";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";
import { sendAffiliateApplicationAdminEmail } from "@/lib/email";

// Where to return after Stripe onboarding
const BASE_URL =
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";
const AFFILIATE_RETURN_PATH =
  process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings";

// Tunables (env-overridable)
const DEFAULT_DISCOUNT_PERCENT = Number(
  process.env.AFFILIATE_DEFAULT_DISCOUNT_PERCENT || "20", // 20% off forever
);
const DEFAULT_PAYOUT_FLAT = Number(
  process.env.AFFILIATE_DEFAULT_PAYOUT || "25", // $25 to affiliate on first paid invoice
);

// Helpers to mirror other affiliate code
const U = (s?: string | null) => (s || "").trim().toUpperCase();
const HOUSE_CODE = U(process.env.AFFILIATE_HOUSE_CODE || "COVE50");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { name, email, teamSize, code } = req.body as {
    name?: string;
    email?: string;
    teamSize?: string | number;
    code?: string;
  };

  if (!name || !email || !teamSize || !code) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const promoCode = U(code);
  if (!promoCode) {
    return res.status(400).json({ error: "Invalid promo code" });
  }

  // Block house / reserved code from being used by affiliates
  if (promoCode === HOUSE_CODE) {
    return res
      .status(400)
      .json({ error: "This promo code is reserved and cannot be used." });
  }

  const SKIP_CONNECT = process.env.DEV_SKIP_BILLING === "1"; // dev-only bypass for Connect

  await dbConnect();

  // Ensure code is unique in our DB (we'll create the same in Stripe below)
  const existing = await Affiliate.findOne({ promoCode });
  if (existing) {
    return res.status(400).json({ error: "Promo code already taken" });
  }

  const user = await User.findOne({ email: session.user.email });
  if (!user) return res.status(404).json({ error: "User not found" });

  // Mongoose 8 types _id as unknown; normalize once and reuse
  const userIdStr = String((user as any)._id ?? (user as any).id);

  // 1) Create (or reuse) Stripe Coupon + Promotion Code so the code is live immediately
  let couponId: string | undefined;
  let promotionCodeId: string | undefined;

  try {
    // Guard: if a promotion code with same text exists in Stripe, reuse it
    const listResp = await stripe.promotionCodes.list({
      code: promoCode,
      limit: 1,
    });
    // Handle both Stripe.Response<List<T>> and older shapes
    const listObj: any = (listResp as any)?.data ?? listResp;
    const promos: any[] = Array.isArray(listObj?.data) ? listObj.data : listObj;

    if (Array.isArray(promos) && promos.length) {
      const p: any = promos[0];
      promotionCodeId = String(p.id);
      couponId =
        typeof p.coupon === "string" ? String(p.coupon) : String(p.coupon?.id);
      // ensure it's active
      if (!p.active) {
        await stripe.promotionCodes.update(String(p.id), { active: true });
      }
    } else {
      const coupon: any = await stripe.coupons.create({
        duration: "forever",
        percent_off: DEFAULT_DISCOUNT_PERCENT,
        name: promoCode,
        metadata: {
          promoCode,
          affiliateUserId: userIdStr,
        },
      });
      couponId = String(coupon.id);

      const promo: any = await stripe.promotionCodes.create({
        coupon: couponId,
        code: promoCode,
        active: true,
        metadata: {
          promoCode,
          affiliateUserId: userIdStr,
        },
      });
      promotionCodeId = String(promo.id);
    }
  } catch (err: any) {
    const devMsg =
      process.env.NODE_ENV !== "production" &&
      (err?.message || err?.error?.message);
    return res
      .status(500)
      .json({ error: devMsg || "Failed to create promotion code" });
  }

  // 2) Create Stripe Connect account (or skip in dev)
  let accountId: string;
  if (!SKIP_CONNECT) {
    try {
      const account: any = await stripe.accounts.create({
        type: "express",
        email,
        capabilities: { transfers: { requested: true } },
        metadata: {
          userId: userIdStr,
          affiliateCode: promoCode,
        },
      });
      accountId = String(account.id);
    } catch (err: any) {
      const devMsg =
        process.env.NODE_ENV !== "production" &&
        (err?.message || err?.error?.message);
      return res.status(500).json({
        error: devMsg || "Stripe account creation failed",
        code: err?.code,
        type: err?.type,
      });
    }
  } else {
    accountId = `acct_mock_${Date.now()}`;
  }

  // 3) Create Affiliate record (mark approved since promo is active)
  try {
    await Affiliate.create({
      userId: (user as any)._id,
      name,
      email,
      teamSize: String(teamSize),
      promoCode,
      stripeConnectId: accountId,
      flatPayoutAmount: DEFAULT_PAYOUT_FLAT,
      totalReferrals: 0,
      totalRevenueGenerated: 0,
      totalPayoutsSent: 0,
      payoutDue: 0,
      lastPayoutDate: undefined,
      onboardingCompleted: false,
      connectedAccountStatus: "pending",
      referrals: [],
      payoutHistory: [],
      approved: true,
      approvedAt: new Date(),
      couponId,
      promotionCodeId,
    } as any);
  } catch {
    return res.status(500).json({ error: "Could not create affiliate" });
  }

  // 4) Update user with referral code (non-critical)
  try {
    (user as any).referralCode = promoCode;
    await user.save();
  } catch {}

  // 5) Create onboarding link (or just bounce back in dev skip mode)
  let accountLinkUrl: string;
  if (!SKIP_CONNECT) {
    try {
      const accountLink: any = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${BASE_URL}${AFFILIATE_RETURN_PATH}`,
        return_url: `${BASE_URL}${AFFILIATE_RETURN_PATH}`,
        type: "account_onboarding",
      });
      accountLinkUrl = String(accountLink.url);
    } catch (err: any) {
      const devMsg =
        process.env.NODE_ENV !== "production" &&
        (err?.message || err?.error?.message);
      return res.status(500).json({
        error: devMsg || "Stripe onboarding link creation failed",
        code: err?.code,
        type: err?.type,
      });
    }
  } else {
    accountLinkUrl = `${BASE_URL}${AFFILIATE_RETURN_PATH}`;
  }

  // 6) Email admin (non-fatal)
  try {
    await sendAffiliateApplicationAdminEmail({
      name,
      email,
      company: "(n/a)",
      agents: teamSize,
      promoCode,
      timestampISO: new Date().toISOString(),
    });
  } catch {
    // swallow
  }

  return res.status(200).json({ stripeUrl: accountLinkUrl });
}

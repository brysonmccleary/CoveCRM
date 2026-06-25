// /pages/api/affiliate/apply.ts

import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
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

/**
 * Legacy note: STRIPE_REFERRAL_COUPON_ID used to back affiliate promo codes.
 * New referral-link affiliates do not create or attach Stripe coupons or promo codes.
 */

function nameSlug(name: string) {
  return name.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 6).padEnd(6, "X");
}

function randomAlpha(length = 4) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function generateUniqueReferralCode(name: string, userId: string) {
  for (let i = 0; i < 8; i++) {
    const code = `${nameSlug(name)}${userId.slice(-4).toUpperCase()}${randomAlpha(4)}`;
    const exists = await Affiliate.findOne({ referralCode: code }).select({ _id: 1 }).lean();
    if (!exists) return code;
  }
  return `${nameSlug(name)}${userId.slice(-4).toUpperCase()}${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  try {
    // Cast the session to any so TS stops complaining about .user.email
    const session = (await getServerSession(
      req,
      res,
      authOptions as any,
    )) as any;

    if (!session?.user?.email) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { name, email, teamSize } = req.body as {
      name?: string;
      email?: string;
      teamSize?: string | number;
    };

    if (!name || !email || !teamSize) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const SKIP_CONNECT = process.env.DEV_SKIP_BILLING === "1"; // dev-only bypass for Connect

    await dbConnect();

    const user = await User.findOne({ email: session.user.email });
    if (!user) return res.status(404).json({ error: "User not found" });

    const userIdStr = String((user as any)._id ?? (user as any).id);
    const referralCode = await generateUniqueReferralCode(name, userIdStr);
    const referralLink = `https://covecrm.com/pricing-select?ref=${encodeURIComponent(referralCode)}`;

    // 2) Create Stripe Connect account (or skip in dev)
    let accountId: string;
    if (!SKIP_CONNECT) {
      try {
        const account = await stripe.accounts.create({
          type: "express",
          email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            userId: userIdStr,
            affiliateCode: referralCode,
            referralCode,
          },
        });
        accountId = account.id;
      } catch (err: any) {
        console.error("[affiliate/apply] Stripe account creation error", {
          message: err?.message,
          code: err?.code,
          type: err?.type,
        });

        const devMsg =
          process.env.NODE_ENV !== "production" &&
          (err?.message || err?.error?.message);

        return res.status(500).json({
          error: devMsg || "Stripe account creation failed",
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
        promoCode: referralCode,
        referralCode,
        stripeConnectId: accountId,
        flatPayoutAmount: 12.50,
        monthlyPayoutRate: 12.50,
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
        couponId: undefined,
        promotionCodeId: undefined,
      } as any);
    } catch (err: any) {
      console.error("[affiliate/apply] Affiliate.create error", {
        message: err?.message,
        name: err?.name,
        errors: err?.errors,
      });
      return res.status(500).json({ error: "Could not create affiliate" });
    }

    // 4) Update user with referral code (non-critical)
    try {
      (user as any).referralCode = referralCode;
      await user.save();
    } catch (err: any) {
      console.warn("[affiliate/apply] Failed to save referralCode on user", {
        message: err?.message,
      });
    }

    // 5) Create onboarding link (or just bounce back in dev skip mode)
    let accountLinkUrl: string;
    if (!SKIP_CONNECT) {
      try {
        const accountLink = await stripe.accountLinks.create({
          account: accountId,
          refresh_url: `${BASE_URL}${AFFILIATE_RETURN_PATH}`,
          return_url: `${BASE_URL}${AFFILIATE_RETURN_PATH}`,
          type: "account_onboarding",
        });
        accountLinkUrl = accountLink.url;
      } catch (err: any) {
        console.error(
          "[affiliate/apply] Stripe accountLink creation error",
          {
            message: err?.message,
            code: err?.code,
            type: err?.type,
          },
        );

        const devMsg =
          process.env.NODE_ENV !== "production" &&
          (err?.message || err?.error?.message);

        return res.status(500).json({
          error: devMsg || "Stripe onboarding link creation failed",
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
        promoCode: referralCode,
        timestampISO: new Date().toISOString(),
      });
    } catch (err: any) {
      console.warn("[affiliate/apply] Failed to send admin email", {
        message: err?.message,
      });
    }

    return res.status(200).json({ stripeUrl: accountLinkUrl, referralCode, referralLink });
  } catch (err: any) {
    console.error("[affiliate/apply] Top-level error", {
      message: err?.message,
      stack: err?.stack,
    });
    return res
      .status(500)
      .json({ error: err?.message || "Affiliate application failed" });
  }
}

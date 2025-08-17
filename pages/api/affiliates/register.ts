// /pages/api/affiliates/register.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import Stripe from "stripe";
import { sendAffiliateApplicationAdminEmail } from "@/lib/email";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10",
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  await dbConnect();

  const { name, email, company, agents, promoCode } = req.body as {
    name?: string;
    email?: string;
    company?: string;
    agents?: number | string;
    promoCode?: string;
  };

  if (!name || !email || !company || !agents || !promoCode) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const upperCode = (promoCode as string).toUpperCase();
  const SKIP = process.env.DEV_SKIP_BILLING === "1";

  // Ensure promo code is unique
  const existing = await Affiliate.findOne({ promoCode: upperCode });
  if (existing) {
    return res.status(409).json({ error: "Promo code already taken" });
  }

  // ✅ 1) Create Stripe Connect account (or mock in dev)
  let account: { id: string };
  if (!SKIP) {
    try {
      const created = await stripe.accounts.create({
        type: "express",
        email,
        capabilities: { transfers: { requested: true } },
      });
      account = { id: created.id };
    } catch (err: any) {
      // Dev-only: surface real Stripe error text to speed up debugging
      console.error("Stripe account creation failed:", err);
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
    account = { id: `acct_mock_${Date.now()}` };
  }

  // ✅ 2) Create Affiliate record
  // NOTE: Your Affiliate schema may require `userId`. If so, this public route
  // will fail validation. We return a helpful error below instead of logging PII.
  let newAffiliate;
  try {
    newAffiliate = await Affiliate.create({
      name,
      email,
      company,
      agents,
      promoCode: upperCode,
      approved: false,
      totalRedemptions: 0,            // ignored if not in schema
      totalRevenueGenerated: 0,       // ignored if not in schema
      payoutDue: 0,
      onboardingCompleted: false,
      connectedAccountStatus: "pending", // normalized to lowercase; ignored if not in schema
      stripeId: account.id,           // some schemas use `stripeId`
      stripeConnectId: account.id,    // others use `stripeConnectId`
    });
  } catch (e: any) {
    // Don’t log PII; return a concise validation message
    if (e?.name === "ValidationError") {
      // Most common case: userId is required on your model for this route
      return res.status(400).json({
        error:
          "Affiliate validation failed. If your model requires userId, use the authenticated /api/affiliate/apply route or let me attach userId by email.",
        details: Object.keys(e?.errors || {}),
      });
    }
    console.error("Affiliate create failed.");
    return res.status(500).json({ error: "Could not create affiliate" });
  }

  // ✅ 3) Generate onboarding link (or mock in dev)
  let stripeLink: string;
  if (!SKIP) {
    try {
      const onboarding = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${process.env.NEXTAUTH_URL}/dashboard/settings`,
        return_url: `${process.env.NEXTAUTH_URL}/dashboard/settings`,
        type: "account_onboarding",
      });
      stripeLink = onboarding.url;
    } catch (err) {
      console.error("Stripe onboarding link failed.");
      return res
        .status(500)
        .json({ error: "Stripe onboarding link creation failed" });
    }
  } else {
    stripeLink = `${process.env.NEXTAUTH_URL}/dashboard/settings?stripe=mock`;
  }

  // ✅ 4) Email Admin (non-fatal on failure; no PII in logs)
  try {
    await sendAffiliateApplicationAdminEmail({
      name,
      email,
      company,
      agents,
      promoCode: upperCode,
      timestampISO: new Date().toISOString(),
      // `to` optional — defaults to AFFILIATE_APPS_EMAIL or ADMIN_EMAIL
    });
  } catch {
    console.warn("Affiliate admin email failed.");
  }

  return res.status(200).json({
    affiliateData: newAffiliate,
    stripeLink,
  });
}

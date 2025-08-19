import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";
import { sendAffiliateApplicationAdminEmail } from "@/lib/email";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
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

  const upperCode = String(promoCode).toUpperCase();
  const SKIP = process.env.DEV_SKIP_BILLING === "1";

  // Ensure promo code is unique
  const existing = await Affiliate.findOne({ promoCode: upperCode });
  if (existing) {
    return res.status(409).json({ error: "Promo code already taken" });
  }

  // 1) Create Stripe Connect account (or mock in dev)
  let accountId = `acct_mock_${Date.now()}`;
  if (!SKIP) {
    try {
      const created = await stripe.accounts.create({
        type: "express",
        email,
        capabilities: { transfers: { requested: true } },
      });
      accountId = created.id;
    } catch (err: any) {
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
  }

  // 2) Create Affiliate record
  let newAffiliate;
  try {
    newAffiliate = await Affiliate.create({
      name,
      email,
      company,
      agents,
      promoCode: upperCode,
      approved: false,
      totalRedemptions: 0,
      totalRevenueGenerated: 0,
      payoutDue: 0,
      onboardingCompleted: false,
      connectedAccountStatus: "pending",
      stripeId: accountId, // if your schema uses `stripeId`
      stripeConnectId: accountId, // if your schema uses `stripeConnectId`
    });
  } catch (e: any) {
    if (e?.name === "ValidationError") {
      return res.status(400).json({
        error:
          "Affiliate validation failed. If your model requires userId, use an authenticated route that can attach it.",
        details: Object.keys(e?.errors || {}),
      });
    }
    console.error("Affiliate create failed.");
    return res.status(500).json({ error: "Could not create affiliate" });
  }

  // 3) Generate onboarding link (or mock in dev)
  let stripeLink =
    `${process.env.NEXTAUTH_URL}/dashboard/settings?stripe=mock` || "";
  if (!SKIP) {
    try {
      const base =
        process.env.NEXT_PUBLIC_BASE_URL ||
        process.env.BASE_URL ||
        process.env.NEXTAUTH_URL ||
        "https://covecrm.com";
      const onboarding = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${base}/dashboard/settings`,
        return_url: `${base}/dashboard/settings`,
        type: "account_onboarding",
      });
      stripeLink = onboarding.url;
    } catch (err) {
      console.error("Stripe onboarding link failed.");
      return res
        .status(500)
        .json({ error: "Stripe onboarding link creation failed" });
    }
  }

  // 4) Email Admin (non-fatal on failure)
  try {
    await sendAffiliateApplicationAdminEmail({
      name,
      email,
      company,
      agents,
      promoCode: upperCode,
      timestampISO: new Date().toISOString(),
    });
  } catch {
    console.warn("Affiliate admin email failed.");
  }

  return res.status(200).json({
    affiliateData: newAffiliate,
    stripeLink,
  });
}

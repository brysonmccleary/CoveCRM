import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";
import { sendAffiliateApplicationAdminEmail } from "@/lib/email";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = normalizeEmail(session?.user?.email);
  const isAdmin = Boolean(session?.user && (session.user as any).role === "admin");

  await dbConnect();

  const { name, email, company, agents, promoCode } = req.body as {
    name?: string;
    email?: string;
    company?: string;
    agents?: number | string;
    promoCode?: string;
  };
  const targetEmail = normalizeEmail(email);

  if (!sessionEmail || (!isAdmin && sessionEmail !== targetEmail)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  if (!name || !targetEmail || !company || !agents || !promoCode) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const upperCode = String(promoCode).toUpperCase();
  const SKIP = process.env.DEV_SKIP_BILLING === "1";

  const existing = await Affiliate.findOne({ promoCode: upperCode });
  if (existing) {
    return res.status(409).json({ error: "Promo code already taken" });
  }

  let accountId = `acct_mock_${Date.now()}`;
  if (!SKIP) {
    try {
      const created = await stripe.accounts.create({
        type: "express",
        email: targetEmail,
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

  let newAffiliate;
  try {
    newAffiliate = await Affiliate.create({
      name,
      email: targetEmail,
      company,
      agents,
      promoCode: upperCode,
      approved: false,
      totalRedemptions: 0,
      totalRevenueGenerated: 0,
      payoutDue: 0,
      onboardingCompleted: false,
      connectedAccountStatus: "pending",
      stripeId: accountId,
      stripeConnectId: accountId,
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

  try {
    await sendAffiliateApplicationAdminEmail({
      name,
      email: targetEmail,
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

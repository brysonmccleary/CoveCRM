import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";
import { authOptions } from "@/pages/api/auth/[...nextauth]";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import User from "@/models/User";
import { stripe } from "@/lib/stripe";

const RETURN_PATH =
  process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings";
const DEV_SKIP = process.env.DEV_SKIP_BILLING === "1";

/** Build absolute base URL from forwarded headers (works on Vercel/ngrok/localhost) */
function getBaseUrl(req: NextApiRequest): string {
  const xfProto = (req.headers["x-forwarded-proto"] as string) || "";
  const xfHost =
    (req.headers["x-forwarded-host"] as string) ||
    (req.headers["host"] as string) ||
    "";
  if (xfHost) {
    const proto =
      xfProto || (xfHost.startsWith("localhost") ? "http" : "https");
    return `${proto}://${xfHost}`;
  }
  return (
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3000"
  );
}

/** Create a Connect Express account for this affiliate in the current Stripe env */
async function createConnectAccount(params: {
  email: string;
  userId: string;
  promoCode: string;
}) {
  const acct = await stripe.accounts.create({
    type: "express",
    email: params.email,
    capabilities: { transfers: { requested: true } },
    metadata: {
      userId: params.userId,
      affiliateCode: params.promoCode,
    },
  });
  return acct.id;
}

/** Ensure the affiliate has a valid (non-mock) Connect account in THIS Stripe mode */
async function ensureConnectAccountId(
  affiliate: any,
  userId: string,
): Promise<string> {
  let id: string =
    typeof affiliate.stripeConnectId === "string"
      ? affiliate.stripeConnectId
      : "";

  // If missing or obviously mocked, create fresh
  if (!id || id.startsWith("acct_mock_")) {
    id = await createConnectAccount({
      email: affiliate.email,
      userId,
      promoCode: affiliate.promoCode,
    });
    affiliate.stripeConnectId = id;
    await affiliate.save();
    return id;
  }

  // Try retrieving; if it's from the wrong environment, recreate
  try {
    await stripe.accounts.retrieve(id);
    return id;
  } catch (err: any) {
    const msg = String(err?.message || "").toLowerCase();
    const missing =
      err?.type === "StripeInvalidRequestError" ||
      msg.includes("no such account") ||
      msg.includes("resource_missing");

    if (!missing) throw err;

    const newId = await createConnectAccount({
      email: affiliate.email,
      userId,
      promoCode: affiliate.promoCode,
    });
    affiliate.stripeConnectId = newId;
    await affiliate.save();
    return newId;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") return res.status(405).end("Method Not Allowed");

  const session = (await getServerSession(
    req,
    res,
    authOptions as any,
  )) as Session | null;

  const email =
    typeof session?.user?.email === "string"
      ? session.user.email.toLowerCase()
      : "";
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    await dbConnect();

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "User not found" });

    // Find or create affiliate row for the current user
    let affiliate =
      (await Affiliate.findOne({ userId: user._id })) ||
      (await Affiliate.findOne({ email: user.email }));

    if (!affiliate) {
      const name =
        `${(user as any).firstName || ""} ${(user as any).lastName || ""}`.trim() ||
        "Affiliate";
      const promo = (
        (user as any).referralCode || `AUTO${user._id.toString().slice(-6)}`
      ).toUpperCase();

      affiliate = await Affiliate.create({
        userId: user._id,
        name,
        email: user.email,
        promoCode: promo,
        flatPayoutAmount: 25,
        totalReferrals: 0,
        totalRevenueGenerated: 0,
        totalPayoutsSent: 0,
        payoutDue: 0,
        onboardingCompleted: false,
        connectedAccountStatus: "pending",
        referrals: [],
        payoutHistory: [],
      });
    }

    // In explicit dev-skip mode, just bounce back to the dashboard path on same origin
    if (DEV_SKIP) {
      return res.status(200).json({ url: RETURN_PATH });
    }

    // Make sure we have a valid Connect account in THIS Stripe environment
    const accountId = await ensureConnectAccountId(affiliate, String(user._id));

    // Create a fresh onboarding link with absolute URLs derived from the request
    const baseUrl = getBaseUrl(req);
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${baseUrl}${RETURN_PATH}`,
      return_url: `${baseUrl}${RETURN_PATH}`,
      type: "account_onboarding",
    });

    return res.status(200).json({ url: link.url });
  } catch (err: any) {
    const msg =
      process.env.NODE_ENV !== "production"
        ? err?.message || String(err)
        : "Failed to start Stripe onboarding";
    console.error("onboard-affiliate error:", err);
    return res.status(500).json({ error: msg });
  }
}

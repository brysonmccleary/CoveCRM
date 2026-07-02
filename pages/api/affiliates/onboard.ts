// pages/api/affiliates/onboard.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

const BASE_URL =
  process.env.NEXTAUTH_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  "http://localhost:3000";
const RETURN_PATH =
  process.env.AFFILIATE_RETURN_PATH || "/dashboard?tab=settings";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const email =
    (req.method === "POST"
      ? (req.body?.email as string | undefined)
      : undefined) ??
    (typeof req.query.email === "string" ? req.query.email : undefined);
  const targetEmail = normalizeEmail(email);

  if (!targetEmail) return res.status(400).json({ error: "Missing email" });

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = normalizeEmail(session?.user?.email);
  const isAdmin = Boolean(session?.user && (session.user as any).role === "admin");
  if (!sessionEmail || (!isAdmin && sessionEmail !== targetEmail)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  await mongooseConnect();

  const affiliate = await Affiliate.findOne({ email: targetEmail });
  if (!affiliate) return res.status(404).json({ error: "Affiliate not found" });

  if (!affiliate.stripeConnectId) {
    const acct = await stripe.accounts.create({
      type: "express",
      email: targetEmail,
      capabilities: { transfers: { requested: true } },
      metadata: { affiliateEmail: targetEmail },
    });
    affiliate.stripeConnectId = acct.id;
    await affiliate.save();
  }

  try {
    const link = await stripe.accountLinks.create({
      account: String(affiliate.stripeConnectId),
      refresh_url: `${BASE_URL}${RETURN_PATH}`,
      return_url: `${BASE_URL}${RETURN_PATH}`,
      type: "account_onboarding",
    });
    return res.status(200).json({ url: link.url });
  } catch (err: any) {
    console.error("Stripe onboarding link error:", err?.message || err);
    return res.status(500).json({ error: "Failed to create onboarding link" });
  }
}

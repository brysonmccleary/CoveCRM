// pages/api/affiliates/confirm.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth/next";
import { authOptions } from "../auth/[...nextauth]";
import mongooseConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const { email } = req.query;
  const targetEmail = normalizeEmail(email);
  if (!targetEmail) return res.status(400).end("Missing email");

  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = normalizeEmail(session?.user?.email);
  const isAdmin = Boolean(session?.user && (session.user as any).role === "admin");
  if (!sessionEmail || (!isAdmin && sessionEmail !== targetEmail)) {
    return res.status(403).end("Unauthorized");
  }

  await mongooseConnect();

  const affiliate = await Affiliate.findOne({ email: targetEmail });
  if (!affiliate || !affiliate.stripeConnectId) {
    return res.status(404).end("Affiliate not found");
  }

  try {
    const connectId = String(affiliate.stripeConnectId);
    const accountResp = await stripe.accounts.retrieve(connectId);
    const detailsSubmitted = Boolean((accountResp as any).details_submitted);

    if (detailsSubmitted) {
      affiliate.onboardingCompleted = true;
      affiliate.connectedAccountStatus = "verified";
      await affiliate.save();
    }

    return res.redirect("/settings?connected=stripe");
  } catch (err) {
    console.error("Affiliate confirm error:", err);
    return res.status(500).end("Stripe account retrieval failed");
  }
}

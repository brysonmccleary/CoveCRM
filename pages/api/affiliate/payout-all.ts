// /pages/api/affiliate/payout-all.ts

import type { NextApiRequest, NextApiResponse } from "next";
import dbConnect from "@/lib/mongooseConnect";
import Affiliate from "@/models/Affiliate";
import { stripe } from "@/lib/stripe";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.ADMIN_PAYOUT_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  await dbConnect();

  const affiliates = await Affiliate.find({
    payoutDue: { $gt: 0 },
    onboardingCompleted: true,
    stripeConnectId: { $exists: true },
  });

  const results: {
    email: string;
    amount: number;
    success: boolean;
    message: string;
  }[] = [];

  for (const affiliate of affiliates) {
    const amountInCents = Math.round(affiliate.payoutDue * 100);

    try {
      await stripe.transfers.create({
        amount: amountInCents,
        currency: "usd",
        destination: affiliate.stripeConnectId!, // ensured by query; non-null assertion for TS
        metadata: {
          affiliateEmail: affiliate.email,
          promoCode: affiliate.promoCode,
        },
      });

      affiliate.payoutHistory.push({
        amount: affiliate.payoutDue,
        userEmail: "SYSTEM",
        date: new Date(),
      });

      affiliate.totalPayoutsSent += affiliate.payoutDue;
      affiliate.payoutDue = 0;
      affiliate.lastPayoutDate = new Date();
      await affiliate.save();

      results.push({
        email: affiliate.email,
        amount: amountInCents / 100,
        success: true,
        message: "Transfer successful",
      });
    } catch (err: any) {
      console.error(
        `❌ Payout failed for ${affiliate.email}:`,
        err?.message || err,
      );
      results.push({
        email: affiliate.email,
        amount: amountInCents / 100,
        success: false,
        message: err?.message || "Transfer failed",
      });
    }
  }

  return res.status(200).json({ status: "completed", results });
}
